import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ModpackConfigInjectorService } from './modpack-config-injector.service';

describe('ModpackConfigInjectorService (RF-STO-14, C-08, C-15)', () => {
  let service: ModpackConfigInjectorService;
  let tempServerDir: string;

  beforeEach(async () => {
    service = new ModpackConfigInjectorService();
    tempServerDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'config-injector-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempServerDir, { recursive: true, force: true });
  });

  it('deve injetar eula=true e server.properties com max-tick-time=-1 para modpacks (C-08, C-15)', async () => {
    await service.injectConfigurationMatrix(tempServerDir, {
      rconPassword: 'secret-rcon-pass',
      isModpack: true,
      serverType: 'FABRIC',
    });

    // 1. Verifica eula.txt
    const eulaContent = await fs.promises.readFile(path.join(tempServerDir, 'eula.txt'), 'utf-8');
    expect(eulaContent).toContain('eula=true');

    // 2. Verifica server.properties
    const propsContent = await fs.promises.readFile(
      path.join(tempServerDir, 'server.properties'),
      'utf-8',
    );
    expect(propsContent).toContain('server-port=25565');
    expect(propsContent).toContain('enable-rcon=true');
    expect(propsContent).toContain('rcon.port=25575');
    expect(propsContent).toContain('rcon.password=secret-rcon-pass');
    expect(propsContent).toContain('online-mode=false');
    expect(propsContent).toContain('enforce-secure-chat=false');
    expect(propsContent).toContain('max-tick-time=-1');
  });

  it('deve configurar max-tick-time=60000 quando não for modpack', async () => {
    await service.injectConfigurationMatrix(tempServerDir, {
      isModpack: false,
      serverType: 'VANILLA',
    });

    const propsContent = await fs.promises.readFile(
      path.join(tempServerDir, 'server.properties'),
      'utf-8',
    );
    expect(propsContent).toContain('max-tick-time=60000');
  });

  it('deve injetar paper-global.yml com proxies desabilitados quando for PAPER ou PURPUR', async () => {
    await service.injectConfigurationMatrix(tempServerDir, {
      serverType: 'PAPER',
    });

    const paperGlobal = await fs.promises.readFile(
      path.join(tempServerDir, 'config', 'paper-global.yml'),
      'utf-8',
    );
    expect(paperGlobal).toContain('velocity:\n    enabled: false');
    expect(paperGlobal).toContain('bungee-cord:\n    online-mode: false');
    // Armadilha C-15: enforce-secure-chat NUNCA deve estar no paper-global.yml
    expect(paperGlobal).not.toContain('enforce-secure-chat');
  });

  it('deve delegar o provisionamento de skins para SkinsProvisionerService (RF-ARQ-22)', async () => {
    const mockSkinsProvisioner = {
      provisionSkins: jest
        .fn()
        .mockResolvedValue({ injected: ['SkinsRestorer.jar'], purgedClientMods: [] }),
    };

    const serviceWithSkins = new ModpackConfigInjectorService(mockSkinsProvisioner as any);
    await serviceWithSkins.injectConfigurationMatrix(tempServerDir, {
      serverType: 'PAPER',
    });

    expect(mockSkinsProvisioner.provisionSkins).toHaveBeenCalledWith(tempServerDir, 'PAPER');
  });
});
