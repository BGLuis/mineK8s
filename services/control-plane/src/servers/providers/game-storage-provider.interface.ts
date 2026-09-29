import { Server } from '@database/entities/server.entity';

/**
 * Ponto de extensão multi-jogo para validação de integridade de dados restaurados (RF-MG-07).
 */
export interface IGameStorageProvider {
  readonly gameType: string;

  /**
   * Hook executado no restore para validar que os dados fundamentais do jogo estão íntegros.
   */
  validateRestoredData(server: Server, dataPath: string): Promise<boolean>;
}

export const GAME_STORAGE_PROVIDER = 'GAME_STORAGE_PROVIDER';
