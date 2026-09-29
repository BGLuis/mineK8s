import { Injectable, Logger } from '@nestjs/common';
import { Server } from '@database/entities/server.entity';
import { IGameStorageProvider } from './game-storage-provider.interface';
import { MinecraftStorageProvider } from './minecraft-storage.provider';

@Injectable()
export class GameStorageProviderRegistry {
  private readonly logger = new Logger(GameStorageProviderRegistry.name);
  private readonly providers = new Map<string, IGameStorageProvider>();

  constructor(minecraftProvider: MinecraftStorageProvider) {
    this.register(minecraftProvider);
  }

  register(provider: IGameStorageProvider): void {
    this.providers.set(provider.gameType.toLowerCase(), provider);
    this.logger.log(`Registrado GameStorageProvider para gameType=[${provider.gameType}]`);
  }

  getProvider(gameType: string): IGameStorageProvider | undefined {
    return this.providers.get((gameType || 'minecraft').toLowerCase());
  }

  async validateRestoredData(server: Server, dataPath: string): Promise<boolean> {
    const provider = this.getProvider(server.game_type || 'minecraft');
    if (!provider) {
      this.logger.warn(
        `Nenhum GameStorageProvider registrado para game_type [${server.game_type}]. Ignorando validação específica.`,
      );
      return true;
    }
    return provider.validateRestoredData(server, dataPath);
  }
}
