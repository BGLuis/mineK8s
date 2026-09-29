import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SkinsProvisionerService } from './skins-provisioner.service';

describe('SkinsProvisionerService (RF-ARQ-22, Armadilha E-05)', () => {
  let service: SkinsProvisionerService;
  let tempServerDir: string;

  beforeEach(async () => {
    service = new SkinsProvisionerService();
    tempServerDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skins-provisioner-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempServerDir, { recursive: true, force: true });
  });

  it('CRITÉRIO DE ACEITE: Paper recebe SkinsRestorer; nenhum mod client-only injetado (E-05)', async () => {
    const modsDir = path.join(tempServerDir, 'mods');
    await fs.promises.mkdir(modsDir, { recursive: true });

    // Simula a presença indevida de CustomSkinLoader e Sodium
    await fs.promises.writeFile(path.join(modsDir, 'CustomSkinLoader_Fabric-14.15.jar'), 'dummy-csl');
    await fs.promises.writeFile(path.join(modsDir, 'sodium-fabric-0.5.8.jar'), 'dummy-sodium');
    await fs.promises.writeFile(path.join(modsDir, 'valid-server-mod.jar'), 'dummy-valid');

    const result = await service.provisionSkins(tempServerDir, 'PAPER');

    // 1. Injetou SkinsRestorer em plugins/
    const pluginsDir = path.join(tempServerDir, 'plugins');
    expect(fs.existsSync(path.join(pluginsDir, 'SkinsRestorer.jar'))).toBe(true);
    expect(result.injected).toContain('SkinsRestorer.jar');

    // 2. CustomSkinLoader e Sodium foram expurgados de mods/ (E-05)
    expect(fs.existsSync(path.join(modsDir, 'CustomSkinLoader_Fabric-14.15.jar'))).toBe(false);
    expect(fs.existsSync(path.join(modsDir, 'sodium-fabric-0.5.8.jar'))).toBe(false);
    expect(result.purgedClientMods).toContain('CustomSkinLoader_Fabric-14.15.jar');
    expect(result.purgedClientMods).toContain('sodium-fabric-0.5.8.jar');

    // 3. Mod server-side legítimo permanece intacto
    expect(fs.existsSync(path.join(modsDir, 'valid-server-mod.jar'))).toBe(true);
  });

  it('deve injetar FabricTailor em /data/mods/ para instâncias FABRIC', async () => {
    const result = await service.provisionSkins(tempServerDir, 'FABRIC');

    const modsDir = path.join(tempServerDir, 'mods');
    expect(fs.existsSync(path.join(modsDir, 'FabricTailor.jar'))).toBe(true);
    expect(result.injected).toContain('FabricTailor.jar');
  });

  it('não deve injetar plugins Bukkit em servidores Forge ou Vanilla', async () => {
    const result = await service.provisionSkins(tempServerDir, 'FORGE');

    const pluginsDir = path.join(tempServerDir, 'plugins');
    expect(fs.existsSync(pluginsDir)).toBe(false);
    expect(result.injected).toHaveLength(0);
  });
});
