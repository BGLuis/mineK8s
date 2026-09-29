import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { Server } from '@database/entities/server.entity';
import { IGameStorageProvider } from './game-storage-provider.interface';

@Injectable()
export class MinecraftStorageProvider implements IGameStorageProvider {
  private readonly logger = new Logger(MinecraftStorageProvider.name);
  readonly gameType = 'minecraft';

  async validateRestoredData(server: Server, dataPath: string): Promise<boolean> {
    const hasRootLevelDat = fs.existsSync(path.join(dataPath, 'level.dat'));
    const hasWorldLevelDat = fs.existsSync(path.join(dataPath, 'world', 'level.dat'));
    const hasServerProperties = fs.existsSync(path.join(dataPath, 'server.properties'));

    const isValid = (hasRootLevelDat || hasWorldLevelDat) && hasServerProperties;
    if (!isValid) {
      this.logger.warn(
        `[RF-MG-07] Falha na validação de integridade do mundo Minecraft para ${server.subdomain}: level.dat=${hasRootLevelDat || hasWorldLevelDat}, server.properties=${hasServerProperties}`,
      );
    }
    return isValid;
  }
}
