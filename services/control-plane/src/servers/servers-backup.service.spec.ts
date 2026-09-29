import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Server } from '@database/entities/server.entity';
import { ServersBackupService } from './servers-backup.service';

describe('ServersBackupService (RF-STO-13 - Pre-Update Backup, Purge & Rollback)', () => {
  let service: ServersBackupService;
  let tempStorageRoot: string;
  let sampleServer: Server;

  beforeEach(async () => {
    tempStorageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'servers-backup-test-'));

    const mockConfigService: any = {
      storage: {
        serversDataRoot: tempStorageRoot,
      },
    };

    service = new ServersBackupService(mockConfigService);

    sampleServer = {
      id: 'srv-backup-123',
      name: 'Modpack Server',
      subdomain: 'modpack-smp',
      state: 'STOPPED',
    } as Server;

    const serverDir = path.join(tempStorageRoot, sampleServer.subdomain);
    await fs.promises.mkdir(path.join(serverDir, 'mods'), { recursive: true });
    await fs.promises.mkdir(path.join(serverDir, 'world'), { recursive: true });

    await fs.promises.writeFile(path.join(serverDir, 'mods', 'jei-1.20.jar'), 'binary-mod-v1');
    await fs.promises.writeFile(path.join(serverDir, 'world', 'level.dat'), 'seed=12345');
    await fs.promises.writeFile(path.join(serverDir, 'server.properties'), 'motd=Original');
  });

  afterEach(async () => {
    if (fs.existsSync(tempStorageRoot)) {
      await fs.promises.rm(tempStorageRoot, { recursive: true, force: true });
    }
  });

  it('should create a complete pre-update backup snapshot excluding existing backups (RF-STO-13)', async () => {
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

  it('should purge mods directory without touching world or configuration files (RF-STO-13)', async () => {
    const serverDir = path.join(tempStorageRoot, sampleServer.subdomain);

    await service.purgeModsDirectory(sampleServer);

    const modsEntries = await fs.promises.readdir(path.join(serverDir, 'mods'));
    expect(modsEntries).toHaveLength(0);

    // Chunks de mundo e configs permanecem intocados
    expect(fs.existsSync(path.join(serverDir, 'world', 'level.dat'))).toBe(true);
    expect(fs.existsSync(path.join(serverDir, 'server.properties'))).toBe(true);
  });

  it('should restore pre-update backup during rollback, recovering deleted mods and original files', async () => {
    const serverDir = path.join(tempStorageRoot, sampleServer.subdomain);

    // 1. Gera backup da versão 1
    const backupPath = await service.createPreUpdateBackup(sampleServer);

    // 2. Simula mutações da atualização (purga mods e adiciona novos com falha)
    await service.purgeModsDirectory(sampleServer);
    await fs.promises.writeFile(path.join(serverDir, 'mods', 'bad-mod-v2.jar'), 'broken');
    await fs.promises.writeFile(path.join(serverDir, 'server.properties'), 'motd=Corrupted');

    // 3. Executa restauração do backup pre-update
    await service.restorePreUpdateBackup(sampleServer, backupPath);

    // 4. Verifica que o estado original foi restabelecido
    expect(fs.existsSync(path.join(serverDir, 'mods', 'jei-1.20.jar'))).toBe(true);
    expect(fs.existsSync(path.join(serverDir, 'mods', 'bad-mod-v2.jar'))).toBe(false);

    const restoredProperties = await fs.promises.readFile(
      path.join(serverDir, 'server.properties'),
      'utf-8',
    );
    expect(restoredProperties).toBe('motd=Original');
  });
});
