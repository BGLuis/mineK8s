import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '@config/app-config.service';
import { Server } from '@database/entities/server.entity';
import {
  ServerContent,
  ServerContentOrigin,
  ServerContentSource,
} from '@database/entities/server-content.entity';
import { serverDataDirectory } from '@k8s/server-data-volume';
import { resolveSafePath } from './security/path-traversal.validator';
import { CasStorageService } from '../modpacks/cas/cas-storage.service';

export interface ContentPreviewItem {
  path: string;
  name: string;
  origin: ServerContentOrigin;
  source: ServerContentSource | null;
  projectId: string | null;
  currentVersionId: string | null;
  status: 'UPDATE_AVAILABLE' | 'INCOMPATIBLE' | 'UNIDENTIFIED' | 'COMPATIBLE';
  statusMessage: string;
  targetVersionId?: string;
  targetVersionName?: string;
  targetDownloadUrl?: string;
  targetFileName?: string;
  targetHashes?: { sha1?: string; sha512?: string; sha256?: string };
}

export interface CompatibilityPreviewResponse {
  canUpdate: boolean;
  targetGameVersion: string;
  targetServerType: string;
  items: ContentPreviewItem[];
}

export interface ContentActionRequest {
  path: string;
  action: 'UPDATE' | 'REMOVE' | 'KEEP';
  projectId?: string;
  targetVersionId?: string;
  targetDownloadUrl?: string;
  targetFileName?: string;
  targetHashes?: { sha1?: string; sha512?: string; sha256?: string };
}

const MODRINTH_API = 'https://api.modrinth.com/v2';
const USER_AGENT = 'BGLuis/mineK8s (control-plane servers-content)';

@Injectable()
export class ServersContentService {
  private readonly logger = new Logger(ServersContentService.name);

  constructor(
    private readonly configService: AppConfigService,
    @InjectRepository(ServerContent)
    private readonly contentRepo: Repository<ServerContent>,
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    @Optional()
    private readonly casStorage?: CasStorageService,
  ) {}

  public getServerDataDir(server: Server): string {
    const baseRoot = path.resolve(this.configService.storage.serversDataRoot);
    const serverDir = path.resolve(baseRoot, serverDataDirectory(server.resource_name));
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }
    return serverDir;
  }

  public async getContents(serverId: string): Promise<ServerContent[]> {
    const server = await this.serverRepo.findOne({ where: { id: serverId } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${serverId}" not found`);
    }
    return this.contentRepo.find({
      where: { serverId },
      order: { path: 'ASC' },
    });
  }

  public async recordContent(params: {
    serverId: string;
    path: string;
    sha1?: string | null;
    sha512?: string | null;
    origin: ServerContentOrigin;
    source?: ServerContentSource | null;
    projectId?: string | null;
    versionId?: string | null;
    loaders?: string[] | null;
  }): Promise<ServerContent> {
    const cleanPath = params.path.replace(/\\/g, '/').replace(/^\/+/, '');
    let existing = await this.contentRepo.findOne({
      where: { serverId: params.serverId, path: cleanPath },
    });

    if (!existing) {
      existing = new ServerContent();
      existing.serverId = params.serverId;
      existing.path = cleanPath;
    }

    if (params.sha1 !== undefined) existing.sha1 = params.sha1;
    if (params.sha512 !== undefined) existing.sha512 = params.sha512;
    if (params.origin) existing.origin = params.origin;
    if (params.source !== undefined) existing.source = params.source;
    if (params.projectId !== undefined) existing.projectId = params.projectId;
    if (params.versionId !== undefined) existing.versionId = params.versionId;
    if (params.loaders !== undefined) existing.loaders = params.loaders;

    return this.contentRepo.save(existing);
  }

  public async removeContent(serverId: string, relPath: string): Promise<void> {
    const cleanPath = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const items = await this.contentRepo.find({ where: { serverId } });
    for (const item of items) {
      if (item.path === cleanPath || item.path.startsWith(`${cleanPath}/`)) {
        await this.contentRepo.delete(item.id);
      }
    }
  }

  /**
   * Identifica arquivos manuais através de consulta de hash na Modrinth (POST /v2/version_files).
   */
  public async identifyContents(serverId: string): Promise<ServerContent[]> {
    const server = await this.serverRepo.findOne({ where: { id: serverId } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${serverId}" not found`);
    }

    const serverDir = this.getServerDataDir(server);

    // Scan mods/ and plugins/ directories for any files on disk not yet recorded
    const dirsToScan = ['mods', 'plugins'];
    for (const subDir of dirsToScan) {
      const fullDir = path.join(serverDir, subDir);
      if (fs.existsSync(fullDir)) {
        try {
          const files = await fs.promises.readdir(fullDir);
          for (const file of files) {
            if (!file.toLowerCase().endsWith('.jar')) {
              continue;
            }
            const relPath = `${subDir}/${file}`.replace(/\\/g, '/');
            const fullPath = path.join(fullDir, file);
            const stat = await fs.promises.stat(fullPath);
            if (stat.isFile()) {
              const existing = await this.contentRepo.findOne({
                where: { serverId, path: relPath },
              });
              if (!existing || !existing.sha1) {
                const buf = await fs.promises.readFile(fullPath);
                const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
                const sha512 = crypto.createHash('sha512').update(buf).digest('hex');
                await this.recordContent({
                  serverId,
                  path: relPath,
                  sha1,
                  sha512,
                  origin: existing?.origin || 'MANUAL',
                  loaders: existing?.loaders,
                });
              }
            }
          }
        } catch (err: any) {
          this.logger.warn(`Erro ao escanear diretório ${subDir}: ${err.message}`);
        }
      }
    }

    const contents = await this.contentRepo.find({ where: { serverId } });
    const toIdentify = contents.filter((c) => !!c.sha1 && (c.origin === 'MANUAL' || !c.projectId));

    if (toIdentify.length === 0) {
      return contents;
    }

    const sha1List = Array.from(new Set(toIdentify.map((c) => c.sha1 as string)));
    try {
      const res = await fetch(`${MODRINTH_API}/version_files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          hashes: sha1List,
          algorithm: 'sha1',
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        const data = (await res.json()) as Record<string, any>;
        for (const item of toIdentify) {
          if (item.sha1 && data[item.sha1]) {
            const versionData = data[item.sha1];
            item.projectId = versionData.project_id || item.projectId;
            item.versionId = versionData.id || item.versionId;
            item.source = 'MODRINTH';
            if (Array.isArray(versionData.loaders)) {
              item.loaders = versionData.loaders;
            }
            await this.contentRepo.save(item);
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`Falha ao identificar arquivos na Modrinth: ${err.message}`);
    }

    return this.contentRepo.find({ where: { serverId }, order: { path: 'ASC' } });
  }

  /**
   * Gera relatório de compatibilidade de mods/plugins antes da atualização de versão.
   */
  public async previewCompatibility(
    serverIdOrServer: string | Server,
    dto: {
      game_version: string;
      server_type?: string;
      modpack_id?: string;
      modpack_version_id?: string;
    },
  ): Promise<CompatibilityPreviewResponse> {
    let server: Server;
    if (typeof serverIdOrServer === 'string') {
      const found = await this.serverRepo.findOne({ where: { id: serverIdOrServer } });
      if (!found) {
        throw new NotFoundException(`Server with ID "${serverIdOrServer}" not found`);
      }
      server = found;
    } else {
      server = serverIdOrServer;
    }

    const targetGameVersion = dto.game_version;
    const targetServerType = (dto.server_type || server.server_type || 'VANILLA').toUpperCase();

    let targetLoaders: string[] = [];
    if (['PAPER', 'PURPUR', 'SPIGOT'].includes(targetServerType)) {
      targetLoaders = ['paper', 'purpur', 'bukkit', 'spigot'];
    } else if (targetServerType === 'FABRIC') {
      targetLoaders = ['fabric'];
    } else if (targetServerType === 'NEOFORGE') {
      targetLoaders = ['neoforge'];
    } else if (targetServerType === 'FORGE') {
      targetLoaders = ['forge'];
    }

    // Identifica quaisquer arquivos manuais pendentes
    await this.identifyContents(server.id);

    const contents = await this.contentRepo.find({
      where: { serverId: server.id },
      order: { path: 'ASC' },
    });

    const sha1List = contents.map((c) => c.sha1).filter((s): s is string => !!s);
    let modrinthUpdates: Record<string, any> = {};
    let modrinthCheckFailed = false;

    if (sha1List.length > 0 && targetLoaders.length > 0) {
      try {
        const res = await fetch(`${MODRINTH_API}/version_files/update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify({
            hashes: sha1List,
            algorithm: 'sha1',
            loaders: targetLoaders,
            game_versions: [targetGameVersion],
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (res.ok) {
          modrinthUpdates = (await res.json()) as Record<string, any>;
        } else {
          modrinthCheckFailed = true;
          this.logger.warn(`Falha na checagem de atualizações Modrinth: status HTTP ${res.status}`);
        }
      } catch (err: any) {
        modrinthCheckFailed = true;
        this.logger.warn(`Falha na checagem de atualizações Modrinth: ${err.message}`);
      }
    }

    const isVanilla = targetServerType === 'VANILLA';

    const items: ContentPreviewItem[] = contents.map((item) => {
      const fileName = path.basename(item.path);
      const updateData = item.sha1 ? modrinthUpdates[item.sha1] : undefined;

      if (isVanilla) {
        return {
          path: item.path,
          name: fileName,
          origin: item.origin,
          source: item.source,
          projectId: item.projectId,
          currentVersionId: item.versionId,
          status: 'INCOMPATIBLE',
          statusMessage: 'Vanilla não suporta mods/plugins',
        };
      }

      if (updateData) {
        const primaryFile = updateData.files?.find((f: any) => f.primary) || updateData.files?.[0];
        const verName = updateData.version_number || updateData.name || updateData.id;

        const isSameVersion =
          (item.versionId && item.versionId === updateData.id) ||
          (primaryFile?.hashes?.sha1 &&
            item.sha1 &&
            primaryFile.hashes.sha1.toLowerCase() === item.sha1.toLowerCase());

        if (isSameVersion) {
          return {
            path: item.path,
            name: fileName,
            origin: item.origin,
            source: item.source,
            projectId: item.projectId || updateData.project_id,
            currentVersionId: item.versionId,
            status: 'COMPATIBLE',
            statusMessage: 'Compatível',
            targetVersionId: updateData.id,
            targetVersionName: verName,
          };
        }

        return {
          path: item.path,
          name: fileName,
          origin: item.origin,
          source: item.source,
          projectId: item.projectId || updateData.project_id,
          currentVersionId: item.versionId,
          status: 'UPDATE_AVAILABLE',
          statusMessage: `Atualiza para ${verName}`,
          targetVersionId: updateData.id,
          targetVersionName: verName,
          targetDownloadUrl: primaryFile?.url,
          targetFileName: primaryFile?.filename,
          targetHashes: primaryFile?.hashes,
        };
      }

      if (modrinthCheckFailed) {
        return {
          path: item.path,
          name: fileName,
          origin: item.origin,
          source: item.source,
          projectId: item.projectId,
          currentVersionId: item.versionId,
          status: 'UNIDENTIFIED',
          statusMessage: 'Não verificado (Modrinth indisponível)',
        };
      }

      if (item.projectId) {
        return {
          path: item.path,
          name: fileName,
          origin: item.origin,
          source: item.source,
          projectId: item.projectId,
          currentVersionId: item.versionId,
          status: 'INCOMPATIBLE',
          statusMessage: 'Sem versão compatível',
        };
      }

      return {
        path: item.path,
        name: fileName,
        origin: item.origin,
        source: item.source,
        projectId: item.projectId,
        currentVersionId: item.versionId,
        status: 'UNIDENTIFIED',
        statusMessage: 'Não identificado',
      };
    });

    return {
      canUpdate: true,
      targetGameVersion,
      targetServerType,
      items,
    };
  }

  /**
   * Aplica ações decididas pelo admin (UPDATE, REMOVE, KEEP) nos arquivos do servidor.
   */
  public async applyContentActions(
    server: Server,
    serverDir: string,
    actions: ContentActionRequest[],
  ): Promise<void> {
    for (const action of actions) {
      const relPath = action.path.replace(/\\/g, '/').replace(/^\/+/, '');

      // Strict validation: Path must remain strictly within mods/ or plugins/
      if (!relPath.startsWith('mods/') && !relPath.startsWith('plugins/')) {
        throw new BadRequestException(
          `Security violation: Content action path must be inside mods/ or plugins/ (${relPath})`,
        );
      }

      // Must be a jar file
      if (!relPath.toLowerCase().endsWith('.jar')) {
        throw new BadRequestException(
          `Security violation: Content action file must be a .jar package (${relPath})`,
        );
      }

      const filePath = resolveSafePath(serverDir, relPath);

      if (action.action === 'REMOVE') {
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
        await this.contentRepo.delete({ serverId: server.id, path: relPath });
        this.logger.log(`Arquivo removido conforme escolha do admin: ${relPath}`);
      } else if (action.action === 'UPDATE') {
        if (!action.targetDownloadUrl) {
          this.logger.warn(`Ação UPDATE para ${relPath} sem URL de download; ignorando.`);
          continue;
        }

        let parsedUrl: URL;
        try {
          parsedUrl = new URL(action.targetDownloadUrl);
        } catch {
          throw new BadRequestException(`Invalid download URL for ${relPath}`);
        }

        if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
          throw new BadRequestException(
            `Security violation: download URL protocol must be HTTP or HTTPS`,
          );
        }

        const dir = path.dirname(relPath);
        if (action.targetFileName) {
          if (
            action.targetFileName.includes('..') ||
            action.targetFileName.includes('/') ||
            action.targetFileName.includes('\\') ||
            action.targetFileName.includes('\0')
          ) {
            throw new BadRequestException(
              `Security violation: targetFileName cannot contain directory traversal or slashes (${action.targetFileName})`,
            );
          }
        }
        const rawFileName = action.targetFileName || path.basename(parsedUrl.pathname);
        const newFileName = path.basename(rawFileName.trim());

        if (
          !newFileName ||
          newFileName === '.' ||
          newFileName === '..' ||
          newFileName.includes('/') ||
          newFileName.includes('\\') ||
          newFileName.includes('\0') ||
          !newFileName.toLowerCase().endsWith('.jar')
        ) {
          throw new BadRequestException(`Invalid target file name: ${rawFileName}`);
        }

        const newRelPath = path.join(dir, newFileName).replace(/\\/g, '/');
        if (!newRelPath.startsWith('mods/') && !newRelPath.startsWith('plugins/')) {
          throw new BadRequestException(
            `Security violation: Target path must remain inside mods/ or plugins/ (${newRelPath})`,
          );
        }

        const newFilePath = resolveSafePath(serverDir, newRelPath);

        const res = await fetch(action.targetDownloadUrl, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) {
          throw new Error(
            `Falha ao baixar versão atualizada de ${relPath} de ${action.targetDownloadUrl}: HTTP ${res.status}`,
          );
        }

        const buffer = Buffer.from(await res.arrayBuffer());

        // Verificação de hashes
        if (action.targetHashes?.sha1) {
          const actualSha1 = crypto.createHash('sha1').update(buffer).digest('hex');
          if (actualSha1.toLowerCase() !== action.targetHashes.sha1.toLowerCase()) {
            throw new Error(
              `Hash mismatch no update de ${relPath}: esperado sha1 ${action.targetHashes.sha1}, obtido ${actualSha1}`,
            );
          }
        }
        if (action.targetHashes?.sha512) {
          const actualSha512 = crypto.createHash('sha512').update(buffer).digest('hex');
          if (actualSha512.toLowerCase() !== action.targetHashes.sha512.toLowerCase()) {
            throw new Error(
              `Hash mismatch no update de ${relPath}: esperado sha512 ${action.targetHashes.sha512}, obtido ${actualSha512}`,
            );
          }
        }
        if (action.targetHashes?.sha256) {
          const actualSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          if (actualSha256.toLowerCase() !== action.targetHashes.sha256.toLowerCase()) {
            throw new Error(
              `Hash mismatch no update de ${relPath}: esperado sha256 ${action.targetHashes.sha256}, obtido ${actualSha256}`,
            );
          }
        }

        await fs.promises.mkdir(path.dirname(newFilePath), { recursive: true });

        if (this.casStorage) {
          const stored = await this.casStorage.store(buffer, newFileName, {
            sha1: action.targetHashes?.sha1,
            sha256: action.targetHashes?.sha256,
          });
          await this.casStorage.copyOrLinkTo(stored.sha256, newFilePath);
        } else {
          await fs.promises.writeFile(newFilePath, buffer);
        }

        const existing = await this.contentRepo.findOne({
          where: { serverId: server.id, path: relPath },
        });

        // Se o nome do arquivo mudou (ex: mod-1.0.jar -> mod-2.0.jar), remove o arquivo antigo
        if (filePath !== newFilePath && fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
          await this.contentRepo.delete({ serverId: server.id, path: relPath });
        }

        const computedSha1 =
          action.targetHashes?.sha1 || crypto.createHash('sha1').update(buffer).digest('hex');
        const computedSha512 =
          action.targetHashes?.sha512 || crypto.createHash('sha512').update(buffer).digest('hex');

        await this.recordContent({
          serverId: server.id,
          path: newRelPath,
          sha1: computedSha1,
          sha512: computedSha512,
          origin: existing?.origin || 'MANUAL',
          source: existing?.source || 'MODRINTH',
          projectId: action.projectId || existing?.projectId,
          versionId: action.targetVersionId || existing?.versionId,
          loaders: existing?.loaders,
        });

        this.logger.log(`Arquivo atualizado com sucesso: ${relPath} -> ${newRelPath}`);
      }
    }
  }

  /**
   * Sincroniza a troca de versão de um modpack:
   * Remove apenas os arquivos instalados pela versão anterior do modpack que não constam no novo.
   * Arquivos com origin === MANUAL sobrevivem intactos.
   */
  public async syncModpackFiles(
    server: Server,
    serverDir: string,
    newPackFiles: Array<{
      path?: string;
      name?: string;
      hashes?: { sha1?: string; sha512?: string };
    }>,
  ): Promise<void> {
    const existing = await this.contentRepo.find({ where: { serverId: server.id } });
    const oldPackItems = existing.filter((e) => e.origin === 'MODPACK');
    const newPaths = new Set(
      newPackFiles.map((f) => {
        const p = f.path || (f.name ? `mods/${f.name}` : '');
        return p.replace(/\\/g, '/').replace(/^\/+/, '');
      }),
    );

    for (const oldItem of oldPackItems) {
      if (!newPaths.has(oldItem.path)) {
        const targetPath = resolveSafePath(serverDir, oldItem.path);
        if (fs.existsSync(targetPath)) {
          await fs.promises.unlink(targetPath);
        }
        await this.contentRepo.delete(oldItem.id);
        this.logger.log(`Arquivo do modpack anterior removido na troca de versão: ${oldItem.path}`);
      }
    }
  }
}
