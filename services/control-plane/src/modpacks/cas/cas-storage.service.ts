import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '@config/app-config.service';
import { CasObjectEntity } from '@database/entities/cas-object.entity';

@Injectable()
export class CasStorageService {
  private readonly logger = new Logger(CasStorageService.name);

  constructor(
    private readonly configService: AppConfigService,
    @Optional()
    @InjectRepository(CasObjectEntity)
    private readonly casRepo?: Repository<CasObjectEntity>,
  ) {}

  public getCacheRootDir(): string {
    const baseCache = path.resolve(this.configService.storage.sharedCachePath);
    const casRoot = path.join(baseCache, 'cas');
    if (!fs.existsSync(casRoot)) {
      fs.mkdirSync(casRoot, { recursive: true });
    }
    return casRoot;
  }

  public computeSha256(data: Buffer | string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  public computeSha1(data: Buffer | string): string {
    return crypto.createHash('sha1').update(data).digest('hex');
  }

  public getCasPath(algo: 'sha1' | 'sha256', hash: string, ext: string = '.jar'): string {
    const cleanHash = hash.toLowerCase().trim();
    const prefix1 = cleanHash.slice(0, 2);
    const prefix2 = cleanHash.slice(2, 4);
    const casRoot = this.getCacheRootDir();
    const dir = path.join(casRoot, algo, prefix1, prefix2);
    return path.join(dir, `${cleanHash}${ext}`);
  }

  public async has(hash: string): Promise<boolean> {
    const obj = await this.getByHash(hash);
    return obj !== null;
  }

  public async getByHash(hash: string): Promise<CasObjectEntity | null> {
    const cleanHash = hash.toLowerCase().trim();
    if (!this.casRepo) {
      return null;
    }

    const isSha256 = cleanHash.length === 64;
    const isSha1 = cleanHash.length === 40;

    let entity: CasObjectEntity | null = null;
    if (isSha256) {
      entity = await this.casRepo.findOne({ where: { sha256: cleanHash } });
    } else if (isSha1) {
      entity = await this.casRepo.findOne({ where: { sha1: cleanHash } });
    } else {
      entity = await this.casRepo.findOne({
        where: [{ sha256: cleanHash }, { sha1: cleanHash }],
      });
    }

    if (!entity) {
      return null;
    }

    // Valida se o arquivo físico ainda existe no disco
    if (!fs.existsSync(entity.storagePath)) {
      this.logger.warn(`Objeto CAS ${cleanHash} ausente em disco (${entity.storagePath}). Purgando registro órfão.`);
      await this.casRepo.delete(entity.sha256);
      return null;
    }

    // Atualiza lastAccessedAt para a governança LRU (RF-STO-05, L-07)
    entity.lastAccessedAt = new Date();
    await this.casRepo.save(entity);

    return entity;
  }

  public async store(
    buffer: Buffer,
    fileName: string,
    options?: { sha1?: string; sha256?: string; contentType?: string },
  ): Promise<CasObjectEntity> {
    const sha256 = options?.sha256?.toLowerCase().trim() || this.computeSha256(buffer);
    const sha1 = options?.sha1?.toLowerCase().trim() || this.computeSha1(buffer);
    const ext = path.extname(fileName) || '.jar';
    const targetPath = this.getCasPath('sha256', sha256, ext);

    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      await fs.promises.mkdir(targetDir, { recursive: true });
    }

    // Gravação atômica via arquivo temporário
    const tmpPath = `${targetPath}.tmp.${Date.now()}`;
    await fs.promises.writeFile(tmpPath, buffer);
    await fs.promises.rename(tmpPath, targetPath);

    const casObject: CasObjectEntity = {
      sha256,
      sha1,
      fileSize: buffer.length,
      fileName,
      contentType: options?.contentType || 'application/java-archive',
      storagePath: targetPath,
      lastAccessedAt: new Date(),
      createdAt: new Date(),
    };

    if (this.casRepo) {
      await this.casRepo.save(casObject);
    }

    this.logger.log(`[RF-STO-05] Objeto armazenado no CAS: ${fileName} [SHA-256: ${sha256}]`);
    return casObject;
  }

  /**
   * Conecta o objeto CAS ao destino desejado (/data/mods).
   * Tenta hardlink em tempo constante (< 10ms); caso falhe (ex: cross-device EXDEV), faz cópia física.
   */
  public async copyOrLinkTo(hash: string, destinationFilePath: string): Promise<'linked' | 'copied'> {
    const casObj = await this.getByHash(hash);
    if (!casObj) {
      throw new NotFoundException(`Objeto CAS não encontrado para o hash: ${hash}`);
    }

    const destDir = path.dirname(destinationFilePath);
    if (!fs.existsSync(destDir)) {
      await fs.promises.mkdir(destDir, { recursive: true });
    }

    // Se arquivo destino já existe, remove antes
    if (fs.existsSync(destinationFilePath)) {
      await fs.promises.unlink(destinationFilePath);
    }

    try {
      await fs.promises.link(casObj.storagePath, destinationFilePath);
      return 'linked';
    } catch (err: any) {
      this.logger.debug(`Hardlink falhou (${err.code || err.message}), usando cópia segura para ${destinationFilePath}`);
      await fs.promises.copyFile(casObj.storagePath, destinationFilePath);
      return 'copied';
    }
  }

  /**
   * Avalia a ocupação do volume /cache e expurga os arquivos menos recentemente usados (LRU)
   * caso a capacidade ultrapasse o limiar (padrão: 85%) (RF-STO-05).
   */
  public async cleanLru(targetCapacityPercent: number = 85): Promise<{ purgedCount: number; purgedBytes: number }> {
    if (!this.casRepo) {
      return { purgedCount: 0, purgedBytes: 0 };
    }

    const casRoot = this.getCacheRootDir();
    let occupancyPercent = 0;

    try {
      if (typeof fs.statfsSync === 'function') {
        const stat = fs.statfsSync(casRoot);
        const total = stat.blocks * stat.bsize;
        const free = stat.bfree * stat.bsize;
        if (total > 0) {
          occupancyPercent = ((total - free) / total) * 100;
        }
      }
    } catch (err: any) {
      this.logger.warn(`Não foi possível checar statfs em ${casRoot}: ${err.message}`);
    }

    if (occupancyPercent <= targetCapacityPercent && occupancyPercent > 0) {
      return { purgedCount: 0, purgedBytes: 0 };
    }

    this.logger.warn(
      `[RF-STO-05] Volume CAS excedeu o limiar de capacidade (${occupancyPercent.toFixed(1)}% > ${targetCapacityPercent}%). Iniciando expurgo LRU...`,
    );

    // Busca os mais antigos pelo último acesso
    const oldestObjects = await this.casRepo.find({
      order: { lastAccessedAt: 'ASC' },
      take: 50,
    });

    let purgedCount = 0;
    let purgedBytes = 0;

    for (const obj of oldestObjects) {
      try {
        if (fs.existsSync(obj.storagePath)) {
          await fs.promises.unlink(obj.storagePath);
        }
        await this.casRepo.delete(obj.sha256);
        purgedCount++;
        purgedBytes += Number(obj.fileSize) || 0;
      } catch (err: any) {
        this.logger.error(`Erro ao purgar objeto CAS ${obj.sha256}: ${err.message}`);
      }
    }

    this.logger.log(`[RF-STO-05] Expurgo LRU concluído: ${purgedCount} objetos removidos (${purgedBytes} bytes liberados).`);
    return { purgedCount, purgedBytes };
  }
}
