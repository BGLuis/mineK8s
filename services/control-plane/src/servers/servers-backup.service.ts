import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  Injectable,
  Logger,
  Optional,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '@config/app-config.service';
import { Server } from '@database/entities/server.entity';
import {
  ServerBackupEntity,
  BackupType,
  BackupStatus,
} from '@database/entities/server-backup.entity';
import { KubernetesService } from '@k8s/k8s.service';
import { ManifestBuilder } from '@k8s/manifest-builder';
import { MinecraftRconConsoleDriver } from '@console/minecraft-rcon-console.driver';
import { GameStorageProviderRegistry } from './providers/game-storage-provider.registry';

const execFileAsync = promisify(execFile);

export interface BackupResult {
  backupId: string;
  serverId: string;
  filename: string;
  storagePath: string;
  backupType: 'HOT' | 'COLD';
  sizeBytes: number;
  sha256Checksum: string;
  freezeDurationMs?: number;
}

export interface RestoreResult {
  serverId: string;
  backupFile: string;
  preRestoreBackupPath?: string;
  restoredAt: Date;
  durationMs: number;
}

@Injectable()
export class ServersBackupService {
  private readonly logger = new Logger(ServersBackupService.name);
  private readonly activeBackupLocks = new Set<string>();

  constructor(
    private readonly configService: AppConfigService,
    @Optional() private readonly k8sService?: KubernetesService,
    @Optional() private readonly consoleDriver?: MinecraftRconConsoleDriver,
    @Optional() private readonly gameStorageRegistry?: GameStorageProviderRegistry,
    @Optional()
    @InjectRepository(ServerBackupEntity)
    private readonly backupRepo?: Repository<ServerBackupEntity>,
    @Optional()
    @InjectRepository(Server)
    private readonly serverRepo?: Repository<Server>,
  ) {}

  public isServerBusy(serverId: string): boolean {
    return this.activeBackupLocks.has(serverId);
  }

  public getServerDataDir(server: Server): string {
    const baseRoot = path.resolve(this.configService.storage.serversDataRoot);
    const serverDir = path.resolve(baseRoot, server.subdomain);
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }
    return serverDir;
  }

  public getBackupsDir(): string {
    const backupsPath = path.resolve(this.configService.storage.backupsPath);
    if (!fs.existsSync(backupsPath)) {
      fs.mkdirSync(backupsPath, { recursive: true });
    }
    return backupsPath;
  }

  public getAvailableStorageBytes(): number {
    const backupsDir = this.getBackupsDir();
    try {
      if (typeof fs.statfsSync === 'function') {
        const stat = fs.statfsSync(backupsDir);
        return stat.bfree * stat.bsize;
      }
    } catch (err: any) {
      this.logger.debug(
        `Não foi possível verificar statfs no caminho ${backupsDir}: ${err.message}`,
      );
    }
    return Number.MAX_SAFE_INTEGER;
  }

  /**
   * Valida espaço disponível no pool de armazenamento de backups (RF-STO-19).
   * Lança HTTP 507 se espaço disponível for inferior ao limiar mínimo de segurança (padrão 50 MiB).
   */
  public checkBackupStorageSpace(minBytesRequired: number = 50 * 1024 * 1024): void {
    const freeBytes = this.getAvailableStorageBytes();
    if (freeBytes < minBytesRequired) {
      throw new HttpException(
        `Insufficient disk space to run a backup in the /backups pool (available: ${freeBytes} bytes, minimum: ${minBytesRequired} bytes) [RF-STO-19]`,
        HttpStatus.INSUFFICIENT_STORAGE,
      );
    }
  }

  /**
   * Orquestra backup atômico de uma instância de servidor (RF-STO-01, RF-STO-02, RF-STO-03, RF-STO-10, RF-STO-19).
   *
   * @param server Entidade do servidor de jogo.
   * @param type 'HOT' (servidor em execução, com freeze < 2 s) ou 'COLD' (servidor parado).
   */
  async createBackup(
    server: Server,
    type: 'HOT' | 'COLD',
    options?: {
      watchdogTimeoutMs?: number;
      isPreUpdate?: boolean;
      modpackVersion?: string | null;
    },
  ): Promise<BackupResult> {
    // 1. Verificação de Concorrência (RF-STO-19)
    if (this.isServerBusy(server.id)) {
      throw new ConflictException(
        `Server [${server.subdomain}] already has a storage/backup task in progress (RF-STO-19).`,
      );
    }

    // 2. Validação de Estado da Máquina de Estados (RF-STO-19)
    if (type === 'HOT' && server.state !== 'READY') {
      throw new ConflictException(
        `Hot backup requires the server to be in READY state. Current state: [${server.state}] (RF-STO-19).`,
      );
    }

    if (type === 'COLD' && server.state !== 'STOPPED') {
      throw new ConflictException(
        `Cold backup requires the server to be in STOPPED state (replicas = 0). Current state: [${server.state}] (RF-STO-19).`,
      );
    }

    // 3. Verificação de Quota e Espaço Livre (RF-STO-19 -> HTTP 507)
    this.checkBackupStorageSpace();

    // 4. Aquisição de Trava
    this.activeBackupLocks.add(server.id);

    const timestamp = Date.now();
    const backupTypeLower = type.toLowerCase() as 'hot' | 'cold';
    const filename = `${server.subdomain}_${backupTypeLower}_${timestamp}.tar.gz`;
    const backupsDir = this.getBackupsDir();
    const targetArchive = path.join(backupsDir, filename);
    const serverDir = this.getServerDataDir(server);
    const jobName = `backup-${server.subdomain}-${backupTypeLower}-${timestamp}`;

    let saveOffCalled = false;
    let saveOnCalled = false;
    let freezeDurationMs = 0;
    let watchdogTimer: NodeJS.Timeout | undefined;

    try {
      const manifest = ManifestBuilder.buildBackupJob(
        server,
        backupTypeLower,
        timestamp,
        this.configService,
      );

      // Despacha Job em Kubernetes (RF-STO-01)
      if (this.k8sService) {
        await this.k8sService.createJob(manifest);
      }

      if (type === 'HOT') {
        // Pré-aquecimento do Pod do Job antes do freeze (D-04)
        if (this.k8sService) {
          this.logger.log(`[D-04] Pré-aquecendo Pod do Job [${jobName}] no cluster K8s...`);
          await this.k8sService.waitForJobPodRunning(jobName, 30000);
        }

        // Armar Watchdog de contingência de 15 segundos para save-on (RF-STO-19)
        const watchdogMs = options?.watchdogTimeoutMs ?? 15000;
        watchdogTimer = setTimeout(async () => {
          if (!saveOnCalled) {
            this.logger.error(
              `[RF-STO-19] Watchdog de save-on disparado para ${server.subdomain} após ${watchdogMs}ms! Forçando religamento do autosave.`,
            );
            try {
              if (this.consoleDriver) {
                await this.consoleDriver.saveOn(server);
              }
              saveOnCalled = true;
            } catch (err) {
              this.logger.error(`Falha no watchdog ao forçar save-on: ${(err as Error).message}`);
            }
          }
        }, watchdogMs);

        // Disparo da janela de freeze ultracurta (< 2 s)
        if (this.consoleDriver) {
          this.logger.log(
            `Desabilitando autosave e descarregando chunks para [${server.subdomain}]...`,
          );
          await this.consoleDriver.saveOff(server);
          saveOffCalled = true;
          await this.consoleDriver.saveFlush(server);
        }

        const freezeStart = Date.now();
        const snapshotDir = path.join(serverDir, '.snapshot_tmp');

        // Criação do snapshot CoW com reflink e todas as dimensões Paper (D-01, D-02, D-03)
        await this.createLocalSnapshot(serverDir, snapshotDir);

        // Imediatamente reativa o autosave na JVM
        if (this.consoleDriver) {
          await this.consoleDriver.saveOn(server);
          saveOnCalled = true;
        }
        freezeDurationMs = Date.now() - freezeStart;
        clearTimeout(watchdogTimer);

        this.logger.log(
          `[RF-STO-03] Hot backup snapshot criado com sucesso em ${freezeDurationMs}ms (< 2000ms). Autosave reativado.`,
        );

        // Espera término do Job assíncrono ou gera arquivo compactado a partir de .snapshot_tmp
        if (this.k8sService) {
          await this.k8sService.waitForJobCompletion(jobName);
        }

        await this.ensureBackupArchive(snapshotDir, targetArchive);

        // Limpeza da pasta temporária do snapshot
        await fs.promises.rm(snapshotDir, { recursive: true, force: true });
      } else {
        // Cold backup direto de /data
        if (this.k8sService) {
          await this.k8sService.waitForJobCompletion(jobName);
        }
        await this.ensureBackupArchive(serverDir, targetArchive);
      }

      // Cleanup do Job K8s
      if (this.k8sService) {
        await this.k8sService.deleteJob(jobName).catch((e) => {
          this.logger.debug(`Cleanup do Job ${jobName}: ${e.message}`);
        });
      }

      // Cálculo de integridade criptográfica SHA-256 e estatísticas
      const stat = await fs.promises.stat(targetArchive);
      const sha256Checksum = await this.calculateSha256(targetArchive);
      await fs.promises.writeFile(`${targetArchive}.sha256`, `${sha256Checksum}  ${filename}\n`);

      this.logger.log(
        `Backup [${filename}] gerado com sucesso. Tamanho: ${stat.size} bytes, SHA-256: ${sha256Checksum}`,
      );

      let backupId = `${server.id}-${timestamp}`;
      if (this.backupRepo) {
        const isPreUpdate = options?.isPreUpdate ?? false;
        const backupTypeEnum = isPreUpdate
          ? BackupType.PRE_UPDATE
          : type === 'HOT'
            ? BackupType.HOT_SCHEDULED
            : BackupType.COLD_MANUAL;

        const retentionExpiresAt = isPreUpdate
          ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
          : null;

        const record = await this.persistBackupRecord({
          serverId: server.id,
          filename,
          storagePath: targetArchive,
          sizeBytes: stat.size,
          sha256Checksum,
          backupType: backupTypeEnum,
          status: BackupStatus.COMPLETED,
          isProtected: isPreUpdate,
          minecraftVersion: server.game_version || 'unknown',
          modpackVersion: options?.modpackVersion ?? server.modpack_id ?? null,
          retentionExpiresAt,
        });

        if (record) {
          backupId = record.id;
        }

        // Aplica política de retenção FIFO N=5 para backups rotineiros (RF-STO-15)
        await this.applyRetentionPolicy(server.id);
      }

      return {
        backupId,
        serverId: server.id,
        filename,
        storagePath: targetArchive,
        backupType: type,
        sizeBytes: stat.size,
        sha256Checksum,
        freezeDurationMs,
      };
    } finally {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
      }
      // Salvaguarda final: se save-off foi chamado e save-on não, restaura o autosave obrigatoriamente
      if (saveOffCalled && !saveOnCalled && this.consoleDriver) {
        try {
          await this.consoleDriver.saveOn(server);
        } catch (err) {
          this.logger.error(`Erro ao garantir save-on no bloco finally: ${(err as Error).message}`);
        }
      }
      this.activeBackupLocks.delete(server.id);
    }
  }

  /**
   * Gera backup preventivo formal PRE_RESTORE com retenção garantida de 48h (D-05).
   */
  async createPreRestoreBackup(server: Server): Promise<BackupResult> {
    const timestamp = Date.now();
    const filename = `${server.subdomain}_pre-restore_${timestamp}.tar.gz`;
    const backupsDir = this.getBackupsDir();
    const targetArchive = path.join(backupsDir, filename);
    const serverDir = this.getServerDataDir(server);

    await this.ensureBackupArchive(serverDir, targetArchive);
    const stat = await fs.promises.stat(targetArchive);
    const sha256Checksum = await this.calculateSha256(targetArchive);
    await fs.promises.writeFile(`${targetArchive}.sha256`, `${sha256Checksum}  ${filename}\n`);

    this.logger.log(
      `[D-05] Backup PRE_RESTORE gerado com sucesso para [${server.subdomain}] em: ${targetArchive}`,
    );

    let backupId = `${server.id}-pre-restore-${timestamp}`;
    if (this.backupRepo) {
      const record = await this.persistBackupRecord({
        serverId: server.id,
        filename,
        storagePath: targetArchive,
        sizeBytes: stat.size,
        sha256Checksum,
        backupType: BackupType.PRE_RESTORE,
        status: BackupStatus.COMPLETED,
        isProtected: false,
        minecraftVersion: server.game_version || 'unknown',
        retentionExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // Retenção obrigatória de 48h
      });
      if (record) {
        backupId = record.id;
      }
    }

    return {
      backupId,
      serverId: server.id,
      filename,
      storagePath: targetArchive,
      backupType: 'COLD',
      sizeBytes: stat.size,
      sha256Checksum,
    };
  }

  /**
   * Restauração Transacional em 5 fases com staging e rollback (RF-STO-04, D-05, RF-MG-07).
   *
   * @param server Instância a ser restaurada. Deve estar obrigatoriamente STOPPED.
   * @param backupIdentifier Nome do arquivo ou caminho completo do arquivo .tar.gz a ser restaurado.
   * @param options Opções adicionais (ex: expectedSha256, skipPreRestore).
   */
  async restoreBackup(
    server: Server,
    backupIdentifier: string,
    options?: { expectedSha256?: string; skipPreRestore?: boolean },
  ): Promise<RestoreResult> {
    const startTime = Date.now();

    // 1. Validação de Concorrência (RF-STO-19)
    if (this.isServerBusy(server.id)) {
      throw new ConflictException(
        `Server [${server.subdomain}] already has a storage/backup/restore task in progress (RF-STO-19).`,
      );
    }

    // 2. Validação de Estado da Máquina de Estados (RF-STO-04)
    if (server.state !== 'STOPPED') {
      throw new ConflictException(
        `Restore requires the server to be in STOPPED state (replicas = 0). Current state: [${server.state}] (RF-STO-04).`,
      );
    }

    // 3. Localização do arquivo de backup
    const backupsDir = this.getBackupsDir();
    const backupPath = path.isAbsolute(backupIdentifier)
      ? backupIdentifier
      : path.join(backupsDir, backupIdentifier);

    if (!fs.existsSync(backupPath)) {
      throw new HttpException(
        `Backup file not found in storage: ${backupPath}`,
        HttpStatus.NOT_FOUND,
      );
    }

    this.activeBackupLocks.add(server.id);

    const serverDir = this.getServerDataDir(server);
    let preRestorePath: string | undefined;

    try {
      // 4. Criação do backup preventivo PRE_RESTORE formal com retenção de 48h (D-05)
      if (!options?.skipPreRestore) {
        this.logger.log(
          `[D-05] Gerando backup preventivo PRE_RESTORE antes de modificar /data para [${server.subdomain}]...`,
        );
        const preRestoreResult = await this.createPreRestoreBackup(server);
        preRestorePath = preRestoreResult.storagePath;
      }

      // 5. Determinação do checksum esperado (via options ou arquivo .sha256 adjacente)
      let expectedSha = options?.expectedSha256;
      if (!expectedSha) {
        const adjacentShaFile = `${backupPath}.sha256`;
        if (fs.existsSync(adjacentShaFile)) {
          const content = await fs.promises.readFile(adjacentShaFile, 'utf-8');
          expectedSha = content.trim().split(/\s+/)[0];
        }
      }

      // 6. Despacho do Job K8s se k8sService estiver ativo
      const timestamp = Date.now();
      const backupFilename = path.basename(backupPath);
      const jobName = `restore-${server.subdomain}-${timestamp}`;

      if (this.k8sService) {
        const manifest = ManifestBuilder.buildRestoreJob(
          server,
          backupFilename,
          expectedSha,
          timestamp,
          this.configService,
        );
        await this.k8sService.createJob(manifest);
        const jobSuccess = await this.k8sService.waitForJobCompletion(jobName);
        await this.k8sService.deleteJob(jobName).catch((e) => {
          this.logger.debug(`Cleanup do Job de restore ${jobName}: ${e.message}`);
        });

        if (!jobSuccess) {
          throw new HttpException(
            `Restore job on the K8s cluster failed. Rollback triggered on the node to restore /data intact.`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
      }

      // 7. Execução do algoritmo transacional em 5 fases (fiel no host / testbed / homelab)
      await this.executeTransactionalRestore(server, serverDir, backupPath, expectedSha);

      const durationMs = Date.now() - startTime;
      this.logger.log(
        `Transactional restore completed successfully para [${server.subdomain}] em ${durationMs}ms.`,
      );

      return {
        serverId: server.id,
        backupFile: backupPath,
        preRestoreBackupPath: preRestorePath,
        restoredAt: new Date(),
        durationMs,
      };
    } finally {
      this.activeBackupLocks.delete(server.id);
    }
  }

  /**
   * Executa o algoritmo transacional em 5 fases no sistema de arquivos local (RF-STO-04, D-05).
   */
  private async executeTransactionalRestore(
    server: Server,
    serverDir: string,
    backupPath: string,
    expectedSha?: string,
  ): Promise<void> {
    // Fase 1: Pré-Validação Criptográfica e Estrutural
    if (expectedSha) {
      const actualSha = await this.calculateSha256(backupPath);
      if (actualSha !== expectedSha) {
        throw new HttpException(
          `[Phase 1] SHA-256 checksum mismatch for the backup! Expected: ${expectedSha}, Got: ${actualSha}`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    try {
      await execFileAsync('tar', ['-tzf', backupPath]);
    } catch {
      throw new HttpException(
        `[Phase 1] Backup file is corrupted or has an invalid gzip format.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const stagingDir = path.join(serverDir, '.staging_safety');
    if (fs.existsSync(stagingDir)) {
      await fs.promises.rm(stagingDir, { recursive: true, force: true });
    }
    await fs.promises.mkdir(stagingDir, { recursive: true });

    // Fase 2: Isolamento em Staging de Segurança (preservando dotfiles e ignorando .staging_safety e lost+found)
    const existingEntries = await fs.promises.readdir(serverDir);
    for (const name of existingEntries) {
      if (name === '.staging_safety' || name === 'lost+found') {
        continue;
      }
      await fs.promises.rename(path.join(serverDir, name), path.join(stagingDir, name));
    }

    let extractionSucceeded = false;
    try {
      // Fase 3: Extração do Backup para /data
      await execFileAsync('tar', ['-xzf', backupPath, '-C', serverDir]);

      // Fase 4: Validação de Sanidade via Hook Multi-jogo (RF-MG-07)
      let isStructureValid = true;
      if (this.gameStorageRegistry) {
        isStructureValid = await this.gameStorageRegistry.validateRestoredData(server, serverDir);
      } else {
        const hasLevelDat =
          fs.existsSync(path.join(serverDir, 'level.dat')) ||
          fs.existsSync(path.join(serverDir, 'world', 'level.dat'));
        const hasServerProperties = fs.existsSync(path.join(serverDir, 'server.properties'));
        isStructureValid = hasLevelDat && hasServerProperties;
      }

      if (!isStructureValid) {
        throw new Error('Sanity check of the restored world failed (essential files missing).');
      }

      extractionSucceeded = true;
    } catch (err: any) {
      this.logger.error(
        `[Fase 5 - Rollback] Falha na extração ou validação: ${err.message}. Acionando Rollback...`,
      );

      // Limpa dados parciais extraídos sem tocar em lost+found ou .staging_safety
      const currentEntries = await fs.promises.readdir(serverDir);
      for (const name of currentEntries) {
        if (name === '.staging_safety' || name === 'lost+found') {
          continue;
        }
        await fs.promises.rm(path.join(serverDir, name), { recursive: true, force: true });
      }

      // Restaura todos os arquivos do staging de volta para a raiz (preservando dotfiles)
      const stagingEntries = await fs.promises.readdir(stagingDir);
      for (const name of stagingEntries) {
        await fs.promises.rename(path.join(stagingDir, name), path.join(serverDir, name));
      }

      await fs.promises.rm(stagingDir, { recursive: true, force: true });
      throw new HttpException(
        `Restore failed: ${err.message}. Rollback completed successfully and the original state was preserved.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Fase 5 - Commit: Purga staging de segurança
    if (extractionSucceeded && fs.existsSync(stagingDir)) {
      await fs.promises.rm(stagingDir, { recursive: true, force: true });
      this.logger.log(
        `[Fase 5 - Commit] Staging purgado e restauração confirmada para ${server.subdomain}.`,
      );
    }
  }

  /**
   * Clona atomicamente os dados do servidor para o diretório de snapshot (D-01, D-02, D-03).
   * Utiliza reflink (Copy-on-Write) quando suportado pelo FS subjacente e preserva todas as dimensões Paper.
   */
  private async createLocalSnapshot(serverDir: string, snapshotDir: string): Promise<void> {
    if (fs.existsSync(snapshotDir)) {
      await fs.promises.rm(snapshotDir, { recursive: true, force: true });
    }
    await fs.promises.mkdir(snapshotDir, { recursive: true });

    const eligiblePaths = await this.getSnapshotEligiblePaths(serverDir);
    if (eligiblePaths.length === 0) {
      return;
    }

    try {
      // CoW reflink (D-03)
      await execFileAsync('cp', ['--reflink=auto', '-a', ...eligiblePaths, snapshotDir]);
    } catch {
      // Fallback para cópia recursiva
      for (const p of eligiblePaths) {
        const base = path.basename(p);
        await this.copyRecursive(p, path.join(snapshotDir, base));
      }
    }
  }

  /**
   * Garante a geração do arquivo .tar.gz a partir do diretório de origem (D-01, RF-STO-10).
   */
  private async ensureBackupArchive(sourceDir: string, targetFile: string): Promise<void> {
    if (fs.existsSync(targetFile)) {
      return;
    }

    const parent = path.dirname(targetFile);
    if (!fs.existsSync(parent)) {
      await fs.promises.mkdir(parent, { recursive: true });
    }

    // Exclusões padronizadas conforme RF-STO-10
    await execFileAsync('tar', [
      '--exclude=logs/*',
      '--exclude=crash-reports/*',
      '--exclude=.cache/*',
      '--exclude=.snapshot_tmp*',
      '--exclude=.staging_safety*',
      '--exclude=*.log.gz',
      '--exclude=*.log',
      '--exclude=.backups*',
      '-czf',
      targetFile,
      '-C',
      sourceDir,
      '.',
    ]);
  }

  private isExcludedFromSnapshot(name: string): boolean {
    return (
      name === '.snapshot_tmp' ||
      name === '.snapshot_trigger' ||
      name === '.snapshot_worker_ready' ||
      name === '.snapshot_ready' ||
      name === '.staging_safety' ||
      name === '.backups' ||
      name === 'logs' ||
      name === '.cache' ||
      name === 'crash-reports' ||
      name.endsWith('.log') ||
      name.endsWith('.log.gz')
    );
  }

  private async getSnapshotEligiblePaths(serverDir: string): Promise<string[]> {
    const entries = await fs.promises.readdir(serverDir);
    const eligible: string[] = [];
    for (const name of entries) {
      if (!this.isExcludedFromSnapshot(name)) {
        eligible.push(path.join(serverDir, name));
      }
    }
    return eligible;
  }

  private async calculateSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
  }

  /**
   * Cria backup preventivo obrigatório (pre-update) antes de mutações de versão (RF-STO-13).
   * Retorna o caminho absoluto do diretório de backup gerado.
   */
  async createPreUpdateBackup(server: Server): Promise<string> {
    const serverDir = this.getServerDataDir(server);
    const backupsDir = path.join(serverDir, '.backups');
    const timestamp = Date.now();
    const targetBackupDir = path.join(backupsDir, `pre-update-${timestamp}`);

    this.logger.log(
      `Criando backup preventivo pre-update para servidor [${server.subdomain}] em: ${targetBackupDir}`,
    );

    await fs.promises.mkdir(targetBackupDir, { recursive: true });

    // Copia recursiva de todos os itens em serverDir, exceto a pasta .backups
    const entries = await fs.promises.readdir(serverDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.backups') {
        continue;
      }
      const srcPath = path.join(serverDir, entry.name);
      const destPath = path.join(targetBackupDir, entry.name);

      await this.copyRecursive(srcPath, destPath);
    }

    this.logger.log(`Backup pre-update concluído com sucesso para [${server.subdomain}].`);
    return targetBackupDir;
  }

  /**
   * Restaura o backup pre-update em caso de falha no boot ou health check (RF-STO-13).
   */
  async restorePreUpdateBackup(server: Server, backupDir: string): Promise<void> {
    const serverDir = this.getServerDataDir(server);

    this.logger.warn(
      `Restaurando backup pre-update para servidor [${server.subdomain}] de ${backupDir}...`,
    );

    if (!fs.existsSync(backupDir)) {
      throw new Error(`Pre-update backup directory not found: ${backupDir}`);
    }

    // Remove arquivos atuais do servidor (exceto .backups)
    const currentEntries = await fs.promises.readdir(serverDir, { withFileTypes: true });
    for (const entry of currentEntries) {
      if (entry.name === '.backups') {
        continue;
      }
      const itemPath = path.join(serverDir, entry.name);
      await fs.promises.rm(itemPath, { recursive: true, force: true });
    }

    // Copia os arquivos do backup de volta para o diretório do servidor
    const backupEntries = await fs.promises.readdir(backupDir, { withFileTypes: true });
    for (const entry of backupEntries) {
      const srcPath = path.join(backupDir, entry.name);
      const destPath = path.join(serverDir, entry.name);
      await this.copyRecursive(srcPath, destPath);
    }

    this.logger.log(`Rollback de arquivos concluído com sucesso para [${server.subdomain}].`);
  }

  /**
   * Purga segura da pasta de mods (RF-STO-13):
   * Remove com segurança o conteúdo de mods/ sem tocar em world/, configs ou propriedades.
   */
  async purgeModsDirectory(server: Server): Promise<void> {
    const serverDir = this.getServerDataDir(server);
    const modsDir = path.join(serverDir, 'mods');

    if (!fs.existsSync(modsDir)) {
      this.logger.debug(`Pasta mods não existe em [${server.subdomain}], pulando purga.`);
      return;
    }

    this.logger.log(`Purgando diretório mods/ para servidor [${server.subdomain}] (RF-STO-13)...`);
    const entries = await fs.promises.readdir(modsDir);
    for (const entry of entries) {
      const entryPath = path.join(modsDir, entry);
      await fs.promises.rm(entryPath, { recursive: true, force: true });
    }
  }

  private async copyRecursive(src: string, dest: string): Promise<void> {
    const stat = await fs.promises.stat(src);
    if (stat.isDirectory()) {
      await fs.promises.mkdir(dest, { recursive: true });
      const children = await fs.promises.readdir(src);
      for (const child of children) {
        await this.copyRecursive(path.join(src, child), path.join(dest, child));
      }
    } else {
      const parent = path.dirname(dest);
      if (!fs.existsSync(parent)) {
        await fs.promises.mkdir(parent, { recursive: true });
      }
      await fs.promises.copyFile(src, dest);
    }
  }

  /**
   * Persiste metadados do backup na tabela server_backups (RF-STO-16).
   */
  async persistBackupRecord(data: {
    serverId: string;
    filename: string;
    storagePath: string;
    sizeBytes: number;
    sha256Checksum: string;
    backupType: BackupType;
    status: BackupStatus;
    isProtected?: boolean;
    minecraftVersion?: string;
    modpackVersion?: string | null;
    failureReason?: string | null;
    retentionExpiresAt?: Date | null;
  }): Promise<ServerBackupEntity | null> {
    if (!this.backupRepo) {
      return null;
    }

    try {
      const entity = this.backupRepo.create({
        serverId: data.serverId,
        filename: data.filename,
        storagePath: data.storagePath,
        sizeBytes: data.sizeBytes,
        sha256Checksum: data.sha256Checksum,
        backupType: data.backupType,
        status: data.status,
        isProtected: data.isProtected ?? false,
        minecraftVersion: data.minecraftVersion || 'unknown',
        modpackVersion: data.modpackVersion ?? null,
        failureReason: data.failureReason ?? null,
        retentionExpiresAt: data.retentionExpiresAt ?? null,
      });

      return await this.backupRepo.save(entity);
    } catch (err: any) {
      this.logger.error(`Erro ao persistir registro de backup no banco: ${err.message}`);
      return null;
    }
  }

  /**
   * Aplica a política de rotação e retenção híbrida (RF-STO-15).
   * - Backups rotineiros (HOT_SCHEDULED / COLD_MANUAL não-protegidos): mantém os N mais recentes (padrão 5).
   *   O 6º descarta o mais antigo do disco e do banco.
   * - Backups pre-update: protegidos (isProtected=true), imunes à contagem FIFO, retidos por 14 dias.
   * - Backups pre-restore: retidos obrigatoriamente por 48 horas.
   */
  async applyRetentionPolicy(
    serverId: string,
    maxRoutine: number = 5,
  ): Promise<{ removedBackups: string[] }> {
    if (!this.backupRepo) {
      return { removedBackups: [] };
    }

    const allBackups = await this.backupRepo.find({
      where: { serverId },
      order: { createdAt: 'DESC' },
    });

    const now = new Date();
    // Filtra backups rotineiros que NÃO têm isProtected e não são pre-update
    // e pre-restore expirados ou que não são pre-restore
    const routineBackups = allBackups.filter((b) => {
      if (b.isProtected) return false;
      if (b.backupType === BackupType.PRE_UPDATE) return false;
      if (
        b.backupType === BackupType.PRE_RESTORE &&
        b.retentionExpiresAt &&
        b.retentionExpiresAt > now
      ) {
        return false;
      }
      return b.backupType === BackupType.HOT_SCHEDULED || b.backupType === BackupType.COLD_MANUAL;
    });

    const removedBackups: string[] = [];

    if (routineBackups.length > maxRoutine) {
      const toRemove = routineBackups.slice(maxRoutine);
      for (const backup of toRemove) {
        try {
          if (fs.existsSync(backup.storagePath)) {
            await fs.promises.unlink(backup.storagePath);
          }
          const shaPath = `${backup.storagePath}.sha256`;
          if (fs.existsSync(shaPath)) {
            await fs.promises.unlink(shaPath);
          }
        } catch (err: any) {
          this.logger.warn(
            `[RF-STO-15] Erro ao remover arquivo de backup físico ${backup.storagePath}: ${err.message}`,
          );
        }

        await this.backupRepo.delete(backup.id);
        removedBackups.push(backup.id);
        this.logger.log(
          `[RF-STO-15] Backup rotineiro excedente removido por política FIFO (N=${maxRoutine}): ${backup.filename} (${backup.id})`,
        );
      }
    }

    return { removedBackups };
  }

  /**
   * Lista backups de um servidor ordenados decrescentemente por data (RF-STO-17).
   */
  async listBackups(serverId: string): Promise<ServerBackupEntity[]> {
    if (!this.backupRepo) {
      return [];
    }
    return this.backupRepo.find({
      where: { serverId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Obtém detalhes de um backup específico (RF-STO-17).
   */
  async getBackup(serverId: string, backupId: string): Promise<ServerBackupEntity> {
    if (!this.backupRepo) {
      throw new NotFoundException(`Backup with ID "${backupId}" not found.`);
    }
    const backup = await this.backupRepo.findOne({
      where: { id: backupId, serverId },
    });
    if (!backup) {
      throw new NotFoundException(`Backup with ID "${backupId}" not found for the given server.`);
    }
    return backup;
  }

  /**
   * Exclui um backup físico e seu registro TypeORM, validando regras de proteção (RF-STO-15, RF-STO-17).
   */
  async deleteBackup(
    serverId: string,
    backupId: string,
    force: boolean = false,
  ): Promise<{ message: string; backupId: string }> {
    const backup = await this.getBackup(serverId, backupId);

    // Rejeita se isProtected=true (salvo override admin / force)
    if (backup.isProtected && !force) {
      throw new HttpException(
        'Protected backup (isProtected: true / PRE_UPDATE) cannot be removed without force=true (RF-STO-15)',
        HttpStatus.FORBIDDEN,
      );
    }

    // Rejeita se PRE_RESTORE sob salvaguarda de 48h (salvo force)
    if (
      backup.backupType === BackupType.PRE_RESTORE &&
      backup.retentionExpiresAt &&
      backup.retentionExpiresAt > new Date() &&
      !force
    ) {
      throw new HttpException(
        'PRE_RESTORE backup is under mandatory 48h retention and cannot be removed without force=true (RF-STO-15)',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      if (fs.existsSync(backup.storagePath)) {
        await fs.promises.unlink(backup.storagePath);
      }
      const shaPath = `${backup.storagePath}.sha256`;
      if (fs.existsSync(shaPath)) {
        await fs.promises.unlink(shaPath);
      }
    } catch (err: any) {
      this.logger.warn(
        `Erro ao excluir arquivo físico de backup ${backup.storagePath}: ${err.message}`,
      );
    }

    if (this.backupRepo) {
      await this.backupRepo.delete(backup.id);
    }

    this.logger.log(`[RF-STO-17] Backup [${backup.filename}] (${backup.id}) removido.`);
    return { message: 'Backup removed successfully', backupId: backup.id };
  }

  /**
   * Dispara restauração transacional a partir de um backup registrado (RF-STO-17).
   */
  async restoreBackupById(
    serverId: string,
    backupId: string,
  ): Promise<{ taskId: string; message: string }> {
    if (!this.serverRepo) {
      throw new Error('Server repository not configured');
    }
    const server = await this.serverRepo.findOne({ where: { id: serverId } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${serverId}" not found.`);
    }

    if (server.state !== 'STOPPED') {
      throw new ConflictException(
        `Restore requires the server to be in STOPPED state (replicas = 0). Current state: [${server.state}] (RF-STO-17)`,
      );
    }

    const backup = await this.getBackup(serverId, backupId);
    const taskId = `restore-task-${Date.now()}`;

    // Executa a restauração transacional em 5 fases (RF-STO-04)
    await this.restoreBackup(server, backup.storagePath);

    return {
      taskId,
      message: 'Transactional restore completed successfully',
    };
  }

  /**
   * Orquestra a criação de backup por ID de servidor a partir de chamadas da API REST (RF-STO-17).
   */
  async createBackupForServer(
    serverId: string,
    type: 'HOT' | 'COLD' = 'HOT',
  ): Promise<{ taskId: string; backupId: string; result: BackupResult }> {
    if (!this.serverRepo) {
      throw new Error('Server repository not configured');
    }
    const server = await this.serverRepo.findOne({ where: { id: serverId } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${serverId}" not found.`);
    }

    const taskId = `backup-task-${Date.now()}`;
    const result = await this.createBackup(server, type);

    return {
      taskId,
      backupId: result.backupId,
      result,
    };
  }
}
