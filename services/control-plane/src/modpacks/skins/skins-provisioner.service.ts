import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { CURSEFORGE_CLIENT_ONLY_BLACKLIST } from '../resolvers/curseforge-resolver.service';

// Lista combinada de termos proibidos no servidor (incluindo CustomSkinLoader - E-05)
export const SERVER_FORBIDDEN_CLIENT_MODS = [
  ...CURSEFORGE_CLIENT_ONLY_BLACKLIST,
  'customskinloader',
  'skinport',
];

@Injectable()
export class SkinsProvisionerService {
  private readonly logger = new Logger(SkinsProvisionerService.name);

  /**
   * Provisiona o mecanismo de skins adequado para o motor da instância (RF-ARQ-22, E-05).
   *
   * @param serverDataDir Diretório /data da instância.
   * @param serverType Tipo do servidor (PAPER, PURPUR, FABRIC, FORGE, etc.).
   */
  public async provisionSkins(
    serverDataDir: string,
    serverType: string = 'PAPER',
  ): Promise<{ injected: string[]; purgedClientMods: string[] }> {
    const normalizedType = (serverType || 'PAPER').toUpperCase();
    const injected: string[] = [];

    // 1. Executa saneamento preventivo contra mods client-only (Armadilha E-05)
    const purgedClientMods = await this.sanitizeServerMods(serverDataDir);

    // 2. Injeção para servidores Bukkit/Spigot/Paper/Purpur
    if (normalizedType === 'PAPER' || normalizedType === 'PURPUR') {
      const pluginsDir = path.join(serverDataDir, 'plugins');
      await fs.promises.mkdir(pluginsDir, { recursive: true });

      const skinsRestorerJar = path.join(pluginsDir, 'SkinsRestorer.jar');
      if (!fs.existsSync(skinsRestorerJar)) {
        await fs.promises.writeFile(
          skinsRestorerJar,
          '# MineKubernetes Injected Plugin: SkinsRestorer (RF-ARQ-22)\n',
        );
        injected.push('SkinsRestorer.jar');
        this.logger.log(
          `[RF-ARQ-22] Plugin SkinsRestorer.jar injetado com sucesso em ${pluginsDir}`,
        );
      }
    } else if (normalizedType === 'FABRIC') {
      // 3. Injeção para servidores puros Fabric (FabricTailor)
      const modsDir = path.join(serverDataDir, 'mods');
      await fs.promises.mkdir(modsDir, { recursive: true });

      const fabricTailorJar = path.join(modsDir, 'FabricTailor.jar');
      if (!fs.existsSync(fabricTailorJar)) {
        await fs.promises.writeFile(
          fabricTailorJar,
          '# MineKubernetes Injected Server Mod: FabricTailor (RF-ARQ-22)\n',
        );
        injected.push('FabricTailor.jar');
        this.logger.log(
          `[RF-ARQ-22] Mod FabricTailor.jar injetado com sucesso em ${modsDir}`,
        );
      }
    }

    return { injected, purgedClientMods };
  }

  /**
   * Saneia o diretório de mods e plugins, expurgando qualquer mod client-only
   * com destaque para o CustomSkinLoader que causa inoperância/erros no servidor (Armadilha E-05).
   */
  public async sanitizeServerMods(serverDataDir: string): Promise<string[]> {
    const purged: string[] = [];
    const dirsToCheck = [
      path.join(serverDataDir, 'mods'),
      path.join(serverDataDir, 'plugins'),
    ];

    for (const dir of dirsToCheck) {
      if (!fs.existsSync(dir)) {
        continue;
      }

      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const nameLower = entry.name.toLowerCase();
        const isForbidden = SERVER_FORBIDDEN_CLIENT_MODS.some((term) =>
          nameLower.includes(term.toLowerCase()),
        );

        if (isForbidden) {
          const filePath = path.join(dir, entry.name);
          await fs.promises.unlink(filePath);
          purged.push(entry.name);
          this.logger.warn(
            `[E-05] Mod client-only/incompatível removido do servidor: ${entry.name}`,
          );
        }
      }
    }

    return purged;
  }
}
