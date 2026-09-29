import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { Server } from '@database/entities/server.entity';
import { ServersBackupService } from './servers-backup.service';

describe('ServersBackupService (RF-STO-01..RF-STO-20)', () => {
  let service: ServersBackupService;
  let tempStorageRoot: string;
  let tempBackupsRoot: string;
  let sampleServer: Server;
  let readyServer: Server;
  let mockConfigService: any;
  let mockConsoleDriver: any;
  let mockK8sService: any;

  beforeEach(async () => {
    tempStorageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'servers-data-test-'));
    tempBackupsRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'servers-backups-test-'));

    mockConfigService = {
      kubernetes: {
        namespace: 'minekubernetes',
        nodeAffinityKey: 'kubernetes.io/hostname',
        nodeAffinityValue: 'node-nvme-1',
      },
      storage: {
        serversDataRoot: tempStorageRoot,
        backupsPath: tempBackupsRoot,
      },
    };

    mockConsoleDriver = {
      saveOff: jest.fn().mockResolvedValue('Automatic saving is now disabled'),
      saveFlush: jest.fn().mockResolvedValue('Saved the game'),
      saveOn: jest.fn().mockResolvedValue('Automatic saving is now enabled'),
    };

    mockK8sService = {
      createJob: jest.fn().mockResolvedValue(undefined),
      waitForJobPodRunning: jest.fn().mockResolvedValue(true),
      waitForJobCompletion: jest.fn().mockResolvedValue(true),
      deleteJob: jest.fn().mockResolvedValue(undefined),
    };

    service = new ServersBackupService(
      mockConfigService,
      mockK8sService,
      mockConsoleDriver,
    );

    sampleServer = {
      id: 'srv-backup-123',
      name: 'Modpack Server',
      subdomain: 'modpack-smp',
      state: 'STOPPED',
      game_type: 'minecraft',
    } as Server;

    readyServer = {
      id: 'srv-ready-456',
      name: 'Paper SMP',
      subdomain: 'paper-smp',
      state: 'READY',
      game_type: 'minecraft',
    } as Server;

    // Configura estrutura de arquivos para sampleServer
    const serverDir = path.join(tempStorageRoot, sampleServer.subdomain);
    await fs.promises.mkdir(path.join(serverDir, 'mods'), { recursive: true });
    await fs.promises.mkdir(path.join(serverDir, 'world'), { recursive: true });
    await fs.promises.writeFile(path.join(serverDir, 'mods', 'jei-1.20.jar'), 'binary-mod-v1');
    await fs.promises.writeFile(path.join(serverDir, 'world', 'level.dat'), 'seed=12345');
    await fs.promises.writeFile(path.join(serverDir, 'server.properties'), 'motd=Original');

    // Configura estrutura com todas as dimensões Paper para readyServer (D-02)
    const readyDir = path.join(tempStorageRoot, readyServer.subdomain);
    await fs.promises.mkdir(path.join(readyDir, 'world', 'region'), { recursive: true });
    await fs.promises.mkdir(path.join(readyDir, 'world_nether', 'DIM-1', 'region'), { recursive: true });
    await fs.promises.mkdir(path.join(readyDir, 'world_the_end', 'DIM1', 'region'), { recursive: true });
    await fs.promises.mkdir(path.join(readyDir, 'logs'), { recursive: true });
    await fs.promises.mkdir(path.join(readyDir, 'crash-reports'), { recursive: true });
    await fs.promises.mkdir(path.join(readyDir, '.cache'), { recursive: true });

    await fs.promises.writeFile(path.join(readyDir, 'world', 'level.dat'), 'original-pre-freeze');
    await fs.promises.writeFile(path.join(readyDir, 'world', 'region', 'r.0.0.mca'), 'chunk-data-overworld');
    await fs.promises.writeFile(path.join(readyDir, 'world_nether', 'DIM-1', 'region', 'r.-1.-1.mca'), 'chunk-data-nether');
    await fs.promises.writeFile(path.join(readyDir, 'world_the_end', 'DIM1', 'region', 'r.0.0.mca'), 'chunk-data-end');
    await fs.promises.writeFile(path.join(readyDir, 'server.properties'), 'motd=ReadyServer');
    await fs.promises.writeFile(path.join(readyDir, 'paper-global.yml'), 'proxies:\n  velocity:\n    enabled: true');
    // Arquivos que devem ser excluídos pelo tar (RF-STO-10)
    await fs.promises.writeFile(path.join(readyDir, 'logs', 'latest.log'), 'secret-log-data');
    await fs.promises.writeFile(path.join(readyDir, 'logs', '2026-09-01-1.log.gz'), 'archived-log');
    await fs.promises.writeFile(path.join(readyDir, 'crash-reports', 'crash-1.txt'), 'crash-dump');
    await fs.promises.writeFile(path.join(readyDir, '.cache', 'temp.dat'), 'cache-data');
  });

  afterEach(async () => {
    if (fs.existsSync(tempStorageRoot)) {
      await fs.promises.rm(tempStorageRoot, { recursive: true, force: true });
    }
    if (fs.existsSync(tempBackupsRoot)) {
      await fs.promises.rm(tempBackupsRoot, { recursive: true, force: true });
    }
  });

  describe('RF-STO-13: Pre-Update Backup, Purge & Rollback', () => {
    it('should create a complete pre-update backup snapshot excluding existing backups', async () => {
      const backupPath = await service.createPreUpdateBackup(sampleServer);

      expect(fs.existsSync(backupPath)).toBe(true);
      expect(fs.existsSync(path.join(backupPath, 'mods', 'jei-1.20.jar'))).toBe(true);
      expect(fs.existsSync(path.join(backupPath, 'world', 'level.dat'))).toBe(true);
      expect(fs.existsSync(path.join(backupPath, 'server.properties'))).toBe(true);

      const backedUpContent = await fs.promises.readFile(
        path.join(backupPath, 'mods', 'jei-1.20.jar'),
        'utf-8',
      );
      expect(backedUpContent).toBe('binary-mod-v1');
    });

    it('should purge mods directory without touching world or configuration files', async () => {
      const serverDir = path.join(tempStorageRoot, sampleServer.subdomain);

      await service.purgeModsDirectory(sampleServer);

      const modsEntries = await fs.promises.readdir(path.join(serverDir, 'mods'));
      expect(modsEntries).toHaveLength(0);

      expect(fs.existsSync(path.join(serverDir, 'world', 'level.dat'))).toBe(true);
      expect(fs.existsSync(path.join(serverDir, 'server.properties'))).toBe(true);
    });

    it('should restore pre-update backup during rollback, recovering deleted mods and original files', async () => {
      const serverDir = path.join(tempStorageRoot, sampleServer.subdomain);

      const backupPath = await service.createPreUpdateBackup(sampleServer);

      await service.purgeModsDirectory(sampleServer);
      await fs.promises.writeFile(path.join(serverDir, 'mods', 'bad-mod-v2.jar'), 'broken');
      await fs.promises.writeFile(path.join(serverDir, 'server.properties'), 'motd=Corrupted');

      await service.restorePreUpdateBackup(sampleServer, backupPath);

      expect(fs.existsSync(path.join(serverDir, 'mods', 'jei-1.20.jar'))).toBe(true);
      expect(fs.existsSync(path.join(serverDir, 'mods', 'bad-mod-v2.jar'))).toBe(false);

      const restoredProperties = await fs.promises.readFile(
        path.join(serverDir, 'server.properties'),
        'utf-8',
      );
      expect(restoredProperties).toBe('motd=Original');
    });
  });

  describe('RF-STO-01, RF-STO-02, RF-STO-03, RF-STO-10 (Hot Backup com Freeze < 2s e Tar Corrigido)', () => {
    it('deve disparar Hot Backup orquestrando pre-heating, save-off, snapshot CoW, save-on imediato e K8s Job', async () => {
      const result = await service.createBackup(readyServer, 'HOT');

      expect(result).toBeDefined();
      expect(result.backupType).toBe('HOT');
      expect(result.serverId).toBe(readyServer.id);
      expect(result.filename).toMatch(new RegExp(`^${readyServer.subdomain}_hot_\\d+\\.tar\\.gz$`));
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(result.sha256Checksum).toHaveLength(64);
      expect(result.freezeDurationMs).toBeDefined();
      expect(result.freezeDurationMs).toBeLessThan(2000); // RF-STO-03: Freeze < 2 segundos garantido

      // RCON sequence (save-off -> flush -> save-on)
      expect(mockConsoleDriver.saveOff).toHaveBeenCalledWith(readyServer);
      expect(mockConsoleDriver.saveFlush).toHaveBeenCalledWith(readyServer);
      expect(mockConsoleDriver.saveOn).toHaveBeenCalledWith(readyServer);

      // K8s Job lifecycle (RF-STO-01)
      expect(mockK8sService.createJob).toHaveBeenCalled();
      expect(mockK8sService.waitForJobPodRunning).toHaveBeenCalled();
      expect(mockK8sService.waitForJobCompletion).toHaveBeenCalled();
      expect(mockK8sService.deleteJob).toHaveBeenCalled();

      // Checa existência física do arquivo e do checksum no volume /backups (RF-STO-02)
      expect(fs.existsSync(result.storagePath)).toBe(true);
      expect(fs.existsSync(`${result.storagePath}.sha256`)).toBe(true);

      const shaFileContent = await fs.promises.readFile(`${result.storagePath}.sha256`, 'utf-8');
      expect(shaFileContent).toContain(result.sha256Checksum);
      expect(shaFileContent).toContain(result.filename);
    });

    it('Critério de Aceite (D-01..D-04): O Tar contém todas as dimensões Paper e o snapshot não muda após save-on', async () => {
      const readyDir = path.join(tempStorageRoot, readyServer.subdomain);

      // Simula escrita in-place da JVM após o religamento do save-on (D-03, D-04)
      mockConsoleDriver.saveOn.mockImplementation(async () => {
        // Imediatamente após save-on, mutamos arquivos na pasta viva /data
        await fs.promises.writeFile(path.join(readyDir, 'world', 'level.dat'), 'MUTATED_POST_FREEZE');
        await fs.promises.writeFile(path.join(readyDir, 'world_nether', 'DIM-1', 'region', 'r.-1.-1.mca'), 'MUTATED_NETHER');
      });

      const result = await service.createBackup(readyServer, 'HOT');

      // Extrai o tar gerado em uma pasta temporária para inspecionar conteúdo
      const extractDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tar-verify-'));
      const { execFile } = require('node:child_process');
      const { promisify } = require('node:util');
      const execAsync = promisify(execFile);

      await execAsync('tar', ['-xzf', result.storagePath, '-C', extractDir]);

      // 1. Todas as dimensões Paper estão presentes (D-02)
      expect(fs.existsSync(path.join(extractDir, 'world', 'region', 'r.0.0.mca'))).toBe(true);
      expect(fs.existsSync(path.join(extractDir, 'world_nether', 'DIM-1', 'region', 'r.-1.-1.mca'))).toBe(true);
      expect(fs.existsSync(path.join(extractDir, 'world_the_end', 'DIM1', 'region', 'r.0.0.mca'))).toBe(true);
      expect(fs.existsSync(path.join(extractDir, 'server.properties'))).toBe(true);
      expect(fs.existsSync(path.join(extractDir, 'paper-global.yml'))).toBe(true);

      // 2. Exclusões respeitadas (RF-STO-10): logs, crash-reports e cache foram excluídos
      expect(fs.existsSync(path.join(extractDir, 'logs'))).toBe(false);
      expect(fs.existsSync(path.join(extractDir, 'crash-reports'))).toBe(false);
      expect(fs.existsSync(path.join(extractDir, '.cache'))).toBe(false);

      // 3. Snapshot não foi afetado pela mutação pós-save-on (D-01, D-03):
      // O level.dat e o nether no tar extraído contêm o valor ORIGINAL no momento do freeze!
      const levelDatInTar = await fs.promises.readFile(path.join(extractDir, 'world', 'level.dat'), 'utf-8');
      expect(levelDatInTar).toBe('original-pre-freeze');
      expect(levelDatInTar).not.toBe('MUTATED_POST_FREEZE');

      const netherInTar = await fs.promises.readFile(path.join(extractDir, 'world_nether', 'DIM-1', 'region', 'r.-1.-1.mca'), 'utf-8');
      expect(netherInTar).toBe('chunk-data-nether');
      expect(netherInTar).not.toBe('MUTATED_NETHER');

      await fs.promises.rm(extractDir, { recursive: true, force: true });
    });
  });

  describe('RF-STO-19: Concorrência, Validação de Estado e Watchdog de 15s', () => {
    it('deve rejeitar com HTTP 409 Conflict se o servidor já tiver um backup em andamento', async () => {
      // Simula uma trava ativa no servidor
      (service as any).activeBackupLocks.add(readyServer.id);

      await expect(service.createBackup(readyServer, 'HOT')).rejects.toThrow(ConflictException);
      await expect(service.createBackup(readyServer, 'HOT')).rejects.toThrow(/em andamento/);
    });

    it('deve rejeitar HOT backup com HTTP 409 se o servidor não estiver no estado READY', async () => {
      sampleServer.state = 'STOPPED';
      await expect(service.createBackup(sampleServer, 'HOT')).rejects.toThrow(ConflictException);
      await expect(service.createBackup(sampleServer, 'HOT')).rejects.toThrow(/estado READY/);
    });

    it('deve rejeitar COLD backup com HTTP 409 se o servidor não estiver no estado STOPPED', async () => {
      readyServer.state = 'READY';
      await expect(service.createBackup(readyServer, 'COLD')).rejects.toThrow(ConflictException);
      await expect(service.createBackup(readyServer, 'COLD')).rejects.toThrow(/estado STOPPED/);
    });

    it('deve garantir execução do save-on mesmo se ocorrer falha inesperada durante o freeze', async () => {
      jest.spyOn<any, any>(service, 'createLocalSnapshot').mockRejectedValueOnce(new Error('Falha de I/O'));

      await expect(service.createBackup(readyServer, 'HOT')).rejects.toThrow('Falha de I/O');

      // Garante que saveOn foi chamado no bloco finally para não deixar o jogo congelado
      expect(mockConsoleDriver.saveOn).toHaveBeenCalledWith(readyServer);
      expect(service.isServerBusy(readyServer.id)).toBe(false);
    });

    it('deve disparar Watchdog de contingência para forçar save-on se o snapshot ultrapassar o tempo limite (RF-STO-19)', async () => {
      let resolveSlowSnapshot: (value?: any) => void = () => {};
      jest.spyOn<any, any>(service, 'createLocalSnapshot').mockImplementationOnce(async (...args: any[]) => {
        const snapDir = args[1] as string;
        await fs.promises.mkdir(snapDir, { recursive: true });
        return new Promise((resolve) => {
          resolveSlowSnapshot = resolve;
        });
      });

      // Dispara com watchdog de 50ms
      const backupPromise = service.createBackup(readyServer, 'HOT', { watchdogTimeoutMs: 50 });

      // Aguarda 100ms em tempo real para que o watchdog dispare
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockConsoleDriver.saveOn).toHaveBeenCalledWith(readyServer);

      resolveSlowSnapshot();
      await backupPromise;
    });

    it('deve lançar HTTP 507 Insufficient Storage quando o espaço livre for insuficiente', () => {
      jest.spyOn(service, 'getAvailableStorageBytes').mockReturnValue(10 * 1024); // 10 KiB livre (< 50 MiB)

      expect(() => service.checkBackupStorageSpace()).toThrow(HttpException);
      try {
        service.checkBackupStorageSpace();
      } catch (err: any) {
        expect(err.getStatus()).toBe(HttpStatus.INSUFFICIENT_STORAGE);
      }
    });
  });

  describe('Cold Backup Execution', () => {
    it('deve realizar Cold Backup com sucesso para servidor STOPPED sem acionar RCON', async () => {
      const result = await service.createBackup(sampleServer, 'COLD');

      expect(result).toBeDefined();
      expect(result.backupType).toBe('COLD');
      expect(result.filename).toMatch(new RegExp(`^${sampleServer.subdomain}_cold_\\d+\\.tar\\.gz$`));
      expect(mockConsoleDriver.saveOff).not.toHaveBeenCalled();
      expect(mockConsoleDriver.saveOn).not.toHaveBeenCalled();
      expect(fs.existsSync(result.storagePath)).toBe(true);
    });
  });
});
