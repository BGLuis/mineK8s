import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Server } from '@database/entities/server.entity';
import { MinecraftStorageProvider } from './minecraft-storage.provider';
import { GameStorageProviderRegistry } from './game-storage-provider.registry';

describe('MinecraftStorageProvider & GameStorageProviderRegistry (RF-MG-07)', () => {
  let tempDir: string;
  let provider: MinecraftStorageProvider;
  let registry: GameStorageProviderRegistry;
  let sampleServer: Server;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mg-provider-test-'));
    provider = new MinecraftStorageProvider();
    registry = new GameStorageProviderRegistry(provider);

    sampleServer = {
      id: 'srv-mg-1',
      subdomain: 'paper-smp',
      game_type: 'minecraft',
    } as Server;
  });

  afterEach(async () => {
    if (fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('deve aprovar restauracao quando world/level.dat e server.properties existem', async () => {
    await fs.promises.mkdir(path.join(tempDir, 'world'), { recursive: true });
    await fs.promises.writeFile(path.join(tempDir, 'world', 'level.dat'), 'data');
    await fs.promises.writeFile(path.join(tempDir, 'server.properties'), 'motd=Test');

    const isValid = await registry.validateRestoredData(sampleServer, tempDir);
    expect(isValid).toBe(true);
  });

  it('deve aprovar restauracao quando level.dat estiver na raiz do dataPath', async () => {
    await fs.promises.writeFile(path.join(tempDir, 'level.dat'), 'data');
    await fs.promises.writeFile(path.join(tempDir, 'server.properties'), 'motd=Test');

    const isValid = await registry.validateRestoredData(sampleServer, tempDir);
    expect(isValid).toBe(true);
  });

  it('deve reprovar restauracao se level.dat estiver ausente', async () => {
    await fs.promises.writeFile(path.join(tempDir, 'server.properties'), 'motd=Test');

    const isValid = await registry.validateRestoredData(sampleServer, tempDir);
    expect(isValid).toBe(false);
  });

  it('deve reprovar restauracao se server.properties estiver ausente', async () => {
    await fs.promises.writeFile(path.join(tempDir, 'level.dat'), 'data');

    const isValid = await registry.validateRestoredData(sampleServer, tempDir);
    expect(isValid).toBe(false);
  });

  it('deve delegar fallback transparente (true) para jogo desconhecido sem provider', async () => {
    const customServer = {
      id: 'srv-other-1',
      subdomain: 'terraria-world',
      game_type: 'terraria',
    } as Server;

    const isValid = await registry.validateRestoredData(customServer, tempDir);
    expect(isValid).toBe(true);
  });
});
