import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { Server } from '@database/entities/server.entity';
import { ServersBackupService } from './servers-backup.service';
import { serverDataDirectory } from '@k8s/server-data-volume';

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

    service = new ServersBackupService(mockConfigService, mockK8sService, mockConsoleDriver);

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
    const serverDir = path.join(tempStorageRoot, serverDataDirectory(sampleServer.subdomain));
    await fs.promises.mkdir(path.join(serverDir, 'mods'), { recursive: true });
    await fs.promises.mkdir(path.join(serverDir, 'world'), { recursive: true });
    await fs.promises.writeFile(path.join(serverDir, 'mods', 'jei-1.20.jar'), 'binary-mod-v1');
    await fs.promises.writeFile(path.join(serverDir, 'world', 'level.dat'), 'seed=12345');
    await fs.promises.writeFile(path.join(serverDir, 'server.properties'), 'motd=Original');

    // Configura estrutura com todas as dimensões Paper para readyServer (D-02)
    const readyDir = path.join(tempStorageRoot, serverDataDirectory(readyServer.subdomain));
    await fs.promises.mkdir(path.join(readyDir, 'world', 'region'), { recursive: true });
    await fs.promises.mkdir(path.join(readyDir, 'world_nether', 'DIM-1', 'region'), {
      recursive: true,
    });
    await fs.promises.mkdir(path.join(readyDir, 'world_the_end', 'DIM1', 'region'), {
      recursive: true,
    });
    await fs.promises.mkdir(path.join(readyDir, 'logs'), { recursive: true });
    await fs.promises.mkdir(path.join(readyDir, 'crash-reports'), { recursive: true });
    await fs.promises.mkdir(path.join(readyDir, '.cache'), { recursive: true });

    await fs.promises.writeFile(path.join(readyDir, 'world', 'level.dat'), 'original-pre-freeze');
    await fs.promises.writeFile(
      path.join(readyDir, 'world', 'region', 'r.0.0.mca'),
      'chunk-data-overworld',
    );
    await fs.promises.writeFile(
      path.join(readyDir, 'world_nether', 'DIM-1', 'region', 'r.-1.-1.mca'),
      'chunk-data-nether',
    );
    await fs.promises.writeFile(
      path.join(readyDir, 'world_the_end', 'DIM1', 'region', 'r.0.0.mca'),
      'chunk-data-end',
    );
    await fs.promises.writeFile(path.join(readyDir, 'server.properties'), 'motd=ReadyServer');
    await fs.promises.writeFile(
      path.join(readyDir, 'paper-global.yml'),
      'proxies:\n  velocity:\n    enabled: true',
    );
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
      const serverDir = path.join(tempStorageRoot, serverDataDirectory(sampleServer.subdomain));

      await service.purgeModsDirectory(sampleServer);

      const modsEntries = await fs.promises.readdir(path.join(serverDir, 'mods'));
      expect(modsEntries).toHaveLength(0);

      expect(fs.existsSync(path.join(serverDir, 'world', 'level.dat'))).toBe(true);
      expect(fs.existsSync(path.join(serverDir, 'server.properties'))).toBe(true);
    });

    it('should restore pre-update backup during rollback, recovering deleted mods and original files', async () => {
      const serverDir = path.join(tempStorageRoot, serverDataDirectory(sampleServer.subdomain));

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
      const readyDir = path.join(tempStorageRoot, serverDataDirectory(readyServer.subdomain));

      // Simula escrita in-place da JVM após o religamento do save-on (D-03, D-04)
      mockConsoleDriver.saveOn.mockImplementation(async () => {
        // Imediatamente após save-on, mutamos arquivos na pasta viva /data
        await fs.promises.writeFile(
          path.join(readyDir, 'world', 'level.dat'),
          'MUTATED_POST_FREEZE',
        );
        await fs.promises.writeFile(
          path.join(readyDir, 'world_nether', 'DIM-1', 'region', 'r.-1.-1.mca'),
          'MUTATED_NETHER',
        );
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
      expect(
        fs.existsSync(path.join(extractDir, 'world_nether', 'DIM-1', 'region', 'r.-1.-1.mca')),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(extractDir, 'world_the_end', 'DIM1', 'region', 'r.0.0.mca')),
      ).toBe(true);
      expect(fs.existsSync(path.join(extractDir, 'server.properties'))).toBe(true);
      expect(fs.existsSync(path.join(extractDir, 'paper-global.yml'))).toBe(true);

      // 2. Exclusões respeitadas (RF-STO-10): logs, crash-reports e cache foram excluídos
      expect(fs.existsSync(path.join(extractDir, 'logs'))).toBe(false);
      expect(fs.existsSync(path.join(extractDir, 'crash-reports'))).toBe(false);
      expect(fs.existsSync(path.join(extractDir, '.cache'))).toBe(false);

      // 3. Snapshot não foi afetado pela mutação pós-save-on (D-01, D-03):
      // O level.dat e o nether no tar extraído contêm o valor ORIGINAL no momento do freeze!
      const levelDatInTar = await fs.promises.readFile(
        path.join(extractDir, 'world', 'level.dat'),
        'utf-8',
      );
      expect(levelDatInTar).toBe('original-pre-freeze');
      expect(levelDatInTar).not.toBe('MUTATED_POST_FREEZE');

      const netherInTar = await fs.promises.readFile(
        path.join(extractDir, 'world_nether', 'DIM-1', 'region', 'r.-1.-1.mca'),
        'utf-8',
      );
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
      await expect(service.createBackup(readyServer, 'HOT')).rejects.toThrow(/in progress/);
    });

    it('deve rejeitar HOT backup com HTTP 409 se o servidor não estiver no estado READY', async () => {
      sampleServer.state = 'STOPPED';
      await expect(service.createBackup(sampleServer, 'HOT')).rejects.toThrow(ConflictException);
      await expect(service.createBackup(sampleServer, 'HOT')).rejects.toThrow(/READY state/);
    });

    it('deve rejeitar COLD backup com HTTP 409 se o servidor não estiver no estado STOPPED', async () => {
      readyServer.state = 'READY';
      await expect(service.createBackup(readyServer, 'COLD')).rejects.toThrow(ConflictException);
      await expect(service.createBackup(readyServer, 'COLD')).rejects.toThrow(/STOPPED state/);
    });

    it('deve garantir execução do save-on mesmo se ocorrer falha inesperada durante o freeze', async () => {
      jest
        .spyOn<any, any>(service, 'createLocalSnapshot')
        .mockRejectedValueOnce(new Error('Falha de I/O'));

      await expect(service.createBackup(readyServer, 'HOT')).rejects.toThrow('Falha de I/O');

      // Garante que saveOn foi chamado no bloco finally para não deixar o jogo congelado
      expect(mockConsoleDriver.saveOn).toHaveBeenCalledWith(readyServer);
      expect(service.isServerBusy(readyServer.id)).toBe(false);
    });

    it('deve disparar Watchdog de contingência para forçar save-on se o snapshot ultrapassar o tempo limite (RF-STO-19)', async () => {
      let resolveSlowSnapshot: (value?: any) => void = () => {};
      jest
        .spyOn<any, any>(service, 'createLocalSnapshot')
        .mockImplementationOnce(async (...args: any[]) => {
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
      expect(result.filename).toMatch(
        new RegExp(`^${sampleServer.subdomain}_cold_\\d+\\.tar\\.gz$`),
      );
      expect(mockConsoleDriver.saveOff).not.toHaveBeenCalled();
      expect(mockConsoleDriver.saveOn).not.toHaveBeenCalled();
      expect(fs.existsSync(result.storagePath)).toBe(true);
    });
  });

  describe('RF-STO-04 & D-05 (Restauração Transacional com Staging e Rollback)', () => {
    let validBackupPath: string;
    let corruptedBackupPath: string;
    let invalidStructureBackupPath: string;

    beforeEach(async () => {
      const { execFile } = require('node:child_process');
      const { promisify } = require('node:util');
      const execAsync = promisify(execFile);

      // 1. Cria um backup íntegro de teste em tempBackupsRoot
      const validSourceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'valid-backup-src-'));
      await fs.promises.mkdir(path.join(validSourceDir, 'world'), { recursive: true });
      await fs.promises.mkdir(path.join(validSourceDir, '.fabric'), { recursive: true });
      await fs.promises.writeFile(
        path.join(validSourceDir, 'world', 'level.dat'),
        'seed=restored-world',
      );
      await fs.promises.writeFile(
        path.join(validSourceDir, 'server.properties'),
        'motd=RestoredServer',
      );
      await fs.promises.writeFile(
        path.join(validSourceDir, '.fabric', 'loader.json'),
        '{"loader":"fabric"}',
      );

      validBackupPath = path.join(tempBackupsRoot, 'valid-backup.tar.gz');
      await execAsync('tar', ['-czf', validBackupPath, '-C', validSourceDir, '.']);
      await fs.promises.rm(validSourceDir, { recursive: true, force: true });

      // 2. Cria um backup corrompido (bytes inválidos)
      corruptedBackupPath = path.join(tempBackupsRoot, 'corrupted-backup.tar.gz');
      await fs.promises.writeFile(corruptedBackupPath, Buffer.from('NOT_A_VALID_GZIP_OR_TAR_DATA'));

      // 3. Cria um backup estruturalmente inválido (falta level.dat)
      const invalidSourceDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'invalid-backup-src-'),
      );
      await fs.promises.writeFile(path.join(invalidSourceDir, 'server.properties'), 'motd=NoWorld');
      invalidStructureBackupPath = path.join(tempBackupsRoot, 'invalid-structure-backup.tar.gz');
      await execAsync('tar', ['-czf', invalidStructureBackupPath, '-C', invalidSourceDir, '.']);
      await fs.promises.rm(invalidSourceDir, { recursive: true, force: true });
    });

    it('deve restaurar com sucesso um backup íntegro gerando PRE_RESTORE prévio (RF-STO-04, D-05)', async () => {
      const serverDir = path.join(tempStorageRoot, serverDataDirectory(sampleServer.subdomain));

      const result = await service.restoreBackup(sampleServer, 'valid-backup.tar.gz');

      expect(result).toBeDefined();
      expect(result.serverId).toBe(sampleServer.id);
      expect(result.preRestoreBackupPath).toBeDefined();
      expect(fs.existsSync(result.preRestoreBackupPath!)).toBe(true);

      // Conteúdo restaurado
      const restoredLevelDat = await fs.promises.readFile(
        path.join(serverDir, 'world', 'level.dat'),
        'utf-8',
      );
      expect(restoredLevelDat).toBe('seed=restored-world');

      const restoredProperties = await fs.promises.readFile(
        path.join(serverDir, 'server.properties'),
        'utf-8',
      );
      expect(restoredProperties).toBe('motd=RestoredServer');

      const restoredDotfile = await fs.promises.readFile(
        path.join(serverDir, '.fabric', 'loader.json'),
        'utf-8',
      );
      expect(restoredDotfile).toBe('{"loader":"fabric"}');

      // Staging de segurança deve ser purgado após commit
      expect(fs.existsSync(path.join(serverDir, '.staging_safety'))).toBe(false);
    });

    it('Critério de Aceite (D-05): Backup corrompido deixa /data 100% idêntico ao estado anterior (Rollback completo)', async () => {
      const serverDir = path.join(tempStorageRoot, serverDataDirectory(sampleServer.subdomain));

      // Simula diretório de sistema lost+found e dotfiles originais em /data
      await fs.promises.mkdir(path.join(serverDir, 'lost+found'), { recursive: true });
      await fs.promises.mkdir(path.join(serverDir, '.hidden_config'), { recursive: true });
      await fs.promises.writeFile(
        path.join(serverDir, '.hidden_config', 'cfg.json'),
        '{"original":true}',
      );

      // Salva snapshot do conteúdo original antes do restore
      const origLevelDat = await fs.promises.readFile(
        path.join(serverDir, 'world', 'level.dat'),
        'utf-8',
      );
      const origProperties = await fs.promises.readFile(
        path.join(serverDir, 'server.properties'),
        'utf-8',
      );
      const origMod = await fs.promises.readFile(
        path.join(serverDir, 'mods', 'jei-1.20.jar'),
        'utf-8',
      );
      const origDotfile = await fs.promises.readFile(
        path.join(serverDir, '.hidden_config', 'cfg.json'),
        'utf-8',
      );

      // Tenta restaurar com arquivo corrompido
      await expect(service.restoreBackup(sampleServer, 'corrupted-backup.tar.gz')).rejects.toThrow(
        HttpException,
      );

      // Validação pós-rollback: tudo deve permanecer idêntico ao estado anterior (D-05)
      expect(fs.existsSync(path.join(serverDir, 'lost+found'))).toBe(true);
      expect(fs.existsSync(path.join(serverDir, '.staging_safety'))).toBe(false);

      expect(await fs.promises.readFile(path.join(serverDir, 'world', 'level.dat'), 'utf-8')).toBe(
        origLevelDat,
      );
      expect(await fs.promises.readFile(path.join(serverDir, 'server.properties'), 'utf-8')).toBe(
        origProperties,
      );
      expect(
        await fs.promises.readFile(path.join(serverDir, 'mods', 'jei-1.20.jar'), 'utf-8'),
      ).toBe(origMod);
      expect(
        await fs.promises.readFile(path.join(serverDir, '.hidden_config', 'cfg.json'), 'utf-8'),
      ).toBe(origDotfile);
    });

    it('deve disparar rollback quando validação de estrutura (RF-MG-07) reprovar o mundo restaurado', async () => {
      const serverDir = path.join(tempStorageRoot, serverDataDirectory(sampleServer.subdomain));
      const origLevelDat = await fs.promises.readFile(
        path.join(serverDir, 'world', 'level.dat'),
        'utf-8',
      );

      // Backup válido como tar mas sem level.dat (sanidade falha)
      await expect(
        service.restoreBackup(sampleServer, 'invalid-structure-backup.tar.gz'),
      ).rejects.toThrow(HttpException);

      // Estado original preservado intacto
      expect(await fs.promises.readFile(path.join(serverDir, 'world', 'level.dat'), 'utf-8')).toBe(
        origLevelDat,
      );
      expect(fs.existsSync(path.join(serverDir, '.staging_safety'))).toBe(false);
    });

    it('deve abortar na Fase 1 sem tocar em /data se o checksum SHA-256 for divergente', async () => {
      const serverDir = path.join(tempStorageRoot, serverDataDirectory(sampleServer.subdomain));
      const origLevelDat = await fs.promises.readFile(
        path.join(serverDir, 'world', 'level.dat'),
        'utf-8',
      );

      await expect(
        service.restoreBackup(sampleServer, 'valid-backup.tar.gz', {
          expectedSha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        }),
      ).rejects.toThrow(/SHA-256 checksum mismatch/);

      expect(await fs.promises.readFile(path.join(serverDir, 'world', 'level.dat'), 'utf-8')).toBe(
        origLevelDat,
      );
      expect(fs.existsSync(path.join(serverDir, '.staging_safety'))).toBe(false);
    });

    it('deve rejeitar restauração com HTTP 409 Conflict se o servidor não estiver STOPPED', async () => {
      readyServer.state = 'READY';
      await expect(service.restoreBackup(readyServer, 'valid-backup.tar.gz')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.restoreBackup(readyServer, 'valid-backup.tar.gz')).rejects.toThrow(
        /STOPPED state/,
      );
    });

    it('deve rejeitar restauração com HTTP 409 Conflict se o servidor já estiver ocupado', async () => {
      (service as any).activeBackupLocks.add(sampleServer.id);
      await expect(service.restoreBackup(sampleServer, 'valid-backup.tar.gz')).rejects.toThrow(
        ConflictException,
      );
    });

    it('deve rejeitar restauração com HTTP 404 se o arquivo de backup não for encontrado', async () => {
      await expect(
        service.restoreBackup(sampleServer, 'non-existent-backup.tar.gz'),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('Política de Retenção e Expurgos (RF-STO-15, RF-STO-16, RF-STO-17)', () => {
    let mockBackupRepo: any;
    let mockServerRepo: any;
    let inMemoryBackups: any[];

    beforeEach(() => {
      inMemoryBackups = [];

      mockBackupRepo = {
        create: jest.fn().mockImplementation((dto) => ({
          id: `backup-uuid-${inMemoryBackups.length + 1}`,
          createdAt: new Date(),
          ...dto,
        })),
        save: jest.fn().mockImplementation(async (entity) => {
          const existingIdx = inMemoryBackups.findIndex((b) => b.id === entity.id);
          if (existingIdx >= 0) {
            inMemoryBackups[existingIdx] = entity;
          } else {
            inMemoryBackups.push(entity);
          }
          return entity;
        }),
        find: jest.fn().mockImplementation(async (options) => {
          let list = [...inMemoryBackups];
          if (options?.where?.serverId) {
            list = list.filter((b) => b.serverId === options.where.serverId);
          }
          if (options?.order?.createdAt === 'DESC') {
            list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          }
          return list;
        }),
        findOne: jest.fn().mockImplementation(async (options) => {
          return inMemoryBackups.find(
            (b) =>
              b.id === options?.where?.id &&
              (!options?.where?.serverId || b.serverId === options.where.serverId),
          );
        }),
        delete: jest.fn().mockImplementation(async (id) => {
          inMemoryBackups = inMemoryBackups.filter((b) => b.id !== id);
          return { affected: 1 };
        }),
      };

      mockServerRepo = {
        findOne: jest.fn().mockImplementation(async ({ where }) => {
          if (where?.id === sampleServer.id) return sampleServer;
          if (where?.id === readyServer.id) return readyServer;
          return null;
        }),
      };

      service = new ServersBackupService(
        mockConfigService,
        mockK8sService,
        mockConsoleDriver,
        undefined,
        mockBackupRepo,
        mockServerRepo,
      );
    });

    it('critério de aceite: 6º backup rotineiro remove o mais antigo; pre-update nunca é removido pela contagem (RF-STO-15)', async () => {
      const serverId = sampleServer.id;

      // Cria backup pre-update protegido (14 dias)
      const preUpdatePath = path.join(tempBackupsRoot, 'pre-update.tar.gz');
      await fs.promises.writeFile(preUpdatePath, 'dummy-preupdate');
      const preUpdate = await service.persistBackupRecord({
        serverId,
        filename: 'pre-update.tar.gz',
        storagePath: preUpdatePath,
        sizeBytes: 100,
        sha256Checksum: 'dummy-sha',
        backupType: 'PRE_UPDATE' as any,
        status: 'COMPLETED' as any,
        isProtected: true,
        minecraftVersion: '1.20.4',
        retentionExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      });

      // Cria 5 backups rotineiros
      const routineBackups: any[] = [];
      for (let i = 1; i <= 5; i++) {
        const filePath = path.join(tempBackupsRoot, `routine-${i}.tar.gz`);
        await fs.promises.writeFile(filePath, `routine-${i}`);
        const b = await service.persistBackupRecord({
          serverId,
          filename: `routine-${i}.tar.gz`,
          storagePath: filePath,
          sizeBytes: 100,
          sha256Checksum: `dummy-sha-${i}`,
          backupType: 'HOT_SCHEDULED' as any,
          status: 'COMPLETED' as any,
          isProtected: false,
          minecraftVersion: '1.20.4',
        });
        // Ajusta data para simular cronologia
        b!.createdAt = new Date(Date.now() - (6 - i) * 60000);
        routineBackups.push(b);
      }

      expect(inMemoryBackups.length).toBe(6); // 1 pre-update + 5 rotineiros

      // Simula a criação do 6º backup rotineiro
      const routine6Path = path.join(tempBackupsRoot, 'routine-6.tar.gz');
      await fs.promises.writeFile(routine6Path, 'routine-6');
      const routine6 = await service.persistBackupRecord({
        serverId,
        filename: 'routine-6.tar.gz',
        storagePath: routine6Path,
        sizeBytes: 100,
        sha256Checksum: 'dummy-sha-6',
        backupType: 'COLD_MANUAL' as any,
        status: 'COMPLETED' as any,
        isProtected: false,
        minecraftVersion: '1.20.4',
      });
      routine6!.createdAt = new Date();

      expect(inMemoryBackups.length).toBe(7);

      // Aplica política de retenção FIFO com N=5
      const { removedBackups } = await service.applyRetentionPolicy(serverId, 5);

      // Deve ter removido exatamente 1 backup rotineiro (o mais antigo routine-1)
      expect(removedBackups).toHaveLength(1);
      expect(removedBackups[0]).toBe(routineBackups[0].id);

      // Arquivo físico de routine-1 deve ter sido deletado
      expect(fs.existsSync(routineBackups[0].storagePath)).toBe(false);

      // O backup pre-update NUNCA pode ter sido removido
      const remainingPreUpdate = inMemoryBackups.find((b) => b.id === preUpdate!.id);
      expect(remainingPreUpdate).toBeDefined();
      expect(fs.existsSync(preUpdatePath)).toBe(true);

      // Devem restar 5 backups rotineiros + 1 pre-update = 6 backups no total
      expect(inMemoryBackups.length).toBe(6);
    });

    it('deve proteger backups PRE_RESTORE por no mínimo 48 horas contra exclusão e rotação', async () => {
      const serverId = sampleServer.id;
      const preRestorePath = path.join(tempBackupsRoot, 'pre-restore.tar.gz');
      await fs.promises.writeFile(preRestorePath, 'dummy-prerestore');

      const preRestore = await service.persistBackupRecord({
        serverId,
        filename: 'pre-restore.tar.gz',
        storagePath: preRestorePath,
        sizeBytes: 200,
        sha256Checksum: 'dummy-sha',
        backupType: 'PRE_RESTORE' as any,
        status: 'COMPLETED' as any,
        isProtected: false,
        minecraftVersion: '1.20.4',
        retentionExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h
      });

      // Tentar deletar sem force deve lançar HTTP 400
      await expect(service.deleteBackup(serverId, preRestore!.id, false)).rejects.toThrow(
        /under mandatory 48h retention/,
      );

      // Com force=true deve remover com sucesso
      const res = await service.deleteBackup(serverId, preRestore!.id, true);
      expect(res.message).toContain('removed successfully');
      expect(fs.existsSync(preRestorePath)).toBe(false);
      expect(inMemoryBackups).toHaveLength(0);
    });

    it('deve rejeitar exclusão de backup com isProtected=true sem force=true', async () => {
      const serverId = sampleServer.id;
      const protPath = path.join(tempBackupsRoot, 'protected.tar.gz');
      await fs.promises.writeFile(protPath, 'dummy-protected');

      const prot = await service.persistBackupRecord({
        serverId,
        filename: 'protected.tar.gz',
        storagePath: protPath,
        sizeBytes: 150,
        sha256Checksum: 'dummy-sha',
        backupType: 'PRE_UPDATE' as any,
        status: 'COMPLETED' as any,
        isProtected: true,
        minecraftVersion: '1.20.4',
      });

      // Sem force -> HTTP 403 Forbidden
      await expect(service.deleteBackup(serverId, prot!.id, false)).rejects.toThrow(
        /isProtected: true/,
      );

      // Com force -> sucesso
      const res = await service.deleteBackup(serverId, prot!.id, true);
      expect(res.message).toContain('removed successfully');
      expect(fs.existsSync(protPath)).toBe(false);
    });

    it('listBackups deve listar backups do servidor ordenados decrescentemente', async () => {
      const serverId = sampleServer.id;
      const b1 = await service.persistBackupRecord({
        serverId,
        filename: 'b1.tar.gz',
        storagePath: '/tmp/b1',
        sizeBytes: 10,
        sha256Checksum: '1',
        backupType: 'COLD_MANUAL' as any,
        status: 'COMPLETED' as any,
        minecraftVersion: '1.20.4',
      });
      b1!.createdAt = new Date(Date.now() - 10000);

      const b2 = await service.persistBackupRecord({
        serverId,
        filename: 'b2.tar.gz',
        storagePath: '/tmp/b2',
        sizeBytes: 20,
        sha256Checksum: '2',
        backupType: 'HOT_SCHEDULED' as any,
        status: 'COMPLETED' as any,
        minecraftVersion: '1.20.4',
      });
      b2!.createdAt = new Date();

      const list = await service.listBackups(serverId);
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe(b2!.id);
      expect(list[1].id).toBe(b1!.id);
    });

    it('restoreBackupById deve exigir que a instância esteja STOPPED', async () => {
      readyServer.state = 'READY';
      const b = await service.persistBackupRecord({
        serverId: readyServer.id,
        filename: 'ready-backup.tar.gz',
        storagePath: '/tmp/ready-backup.tar.gz',
        sizeBytes: 50,
        sha256Checksum: '3',
        backupType: 'COLD_MANUAL' as any,
        status: 'COMPLETED' as any,
        minecraftVersion: '1.20.4',
      });

      await expect(service.restoreBackupById(readyServer.id, b!.id)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.restoreBackupById(readyServer.id, b!.id)).rejects.toThrow(
        /STOPPED state/,
      );
    });

    it('createBackupForServer deve registrar tarefa e atualizar progresso assíncrono', async () => {
      const mockTaskExecutionService = {
        register: jest.fn(),
        update: jest.fn(),
        getTask: jest.fn(),
      };

      const customService = new ServersBackupService(
        mockConfigService,
        mockK8sService,
        mockConsoleDriver,
        undefined,
        mockBackupRepo,
        mockServerRepo,
        mockTaskExecutionService as any,
      );

      const result = await customService.createBackupForServer(readyServer.id, 'HOT');
      expect(result.taskId).toMatch(/^backup-task-/);
      expect(mockTaskExecutionService.register).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: result.taskId,
          serverId: readyServer.id,
          status: 'IN_PROGRESS',
        }),
      );
      expect(mockTaskExecutionService.update).toHaveBeenCalledWith(
        result.taskId,
        expect.objectContaining({
          status: 'COMPLETED',
          progressPercent: 100,
        }),
      );
    });
  });
});
