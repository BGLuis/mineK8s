import { Server } from '../database/entities/server.entity';

export interface CommandOptions {
  timeoutMs?: number;
}

/**
 * Interface agnóstica de driver de console de jogos (RF-MG-05).
 * Abstrai operações de console (Minecraft RCON, Terraria REST, etc.).
 */
export interface ConsoleDriver {
  /**
   * Executa um comando textual direto no console do servidor.
   */
  sendCommand(
    server: Server,
    command: string,
    options?: CommandOptions,
  ): Promise<string>;

  /**
   * Obtém a lista de jogadores atualmente conectados.
   */
  listPlayers(server: Server): Promise<string[]>;

  /**
   * Desativa a gravação automática no disco (preparação para snapshot/backup).
   */
  saveOff(server: Server): Promise<string>;

  /**
   * Força a sincronização e flush completo do mundo para o disco.
   * Suporta timeout estendido (Guarda L-08).
   */
  saveFlush(server: Server, timeoutMs?: number): Promise<string>;

  /**
   * Reativa a gravação automática no disco após término do backup.
   */
  saveOn(server: Server): Promise<string>;
}

export const CONSOLE_DRIVER_TOKEN = Symbol('CONSOLE_DRIVER_TOKEN');
