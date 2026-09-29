import { Injectable, Logger } from '@nestjs/common';
import { Server } from '../database/entities/server.entity';
import { RconConnectionPool } from '../rcon/pool/rcon-connection-pool';
import {
  CommandOptions,
  ConsoleDriver,
} from './console-driver.interface';

@Injectable()
export class MinecraftRconConsoleDriver implements ConsoleDriver {
  private readonly logger = new Logger(MinecraftRconConsoleDriver.name);

  constructor(private readonly connectionPool: RconConnectionPool) {}

  public async sendCommand(
    server: Server,
    command: string,
    options?: CommandOptions,
  ): Promise<string> {
    const client = await this.connectionPool.getOrCreateConnection(server);
    return client.sendCommand(command, options?.timeoutMs);
  }

  public async listPlayers(server: Server): Promise<string[]> {
    try {
      const output = await this.sendCommand(server, 'list');
      // Format ex: "There are 2 of a max of 20 players online: Steve, Alex"
      const colonIndex = output.indexOf(':');
      if (colonIndex === -1) {
        return [];
      }

      const playersPart = output.substring(colonIndex + 1).trim();
      if (!playersPart) {
        return [];
      }

      return playersPart
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    } catch (err) {
      this.logger.warn(
        `Erro ao listar jogadores para ${server.subdomain}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  public async saveOff(server: Server): Promise<string> {
    return this.sendCommand(server, 'save-off');
  }

  /**
   * Guarda L-08: save-all flush em mundos grandes com preset estendido de 60s
   */
  public async saveFlush(
    server: Server,
    timeoutMs: number = 60000,
  ): Promise<string> {
    return this.sendCommand(server, 'save-all flush', { timeoutMs });
  }

  public async saveOn(server: Server): Promise<string> {
    return this.sendCommand(server, 'save-on');
  }

  public async stop(server: Server): Promise<string> {
    return this.sendCommand(server, 'stop');
  }

  /**
   * Executa graceful shutdown completo (RF-ARQ-08):
   * 1. save-all flush (persistência síncrona do mundo)
   * 2. stop (encerramento ordenado da JVM)
   */
  public async gracefulShutdown(server: Server): Promise<void> {
    this.logger.log(`Iniciando graceful shutdown para o servidor [${server.subdomain}] via RCON (RF-ARQ-08)...`);
    try {
      await this.saveFlush(server, 15000);
      this.logger.log(`save-all flush concluído com sucesso para [${server.subdomain}].`);
    } catch (err: any) {
      this.logger.warn(`Aviso no save-all flush durante shutdown de [${server.subdomain}]: ${err.message}`);
    }

    try {
      await this.stop(server);
      this.logger.log(`Comando stop emitido com sucesso para [${server.subdomain}].`);
    } catch (err: any) {
      this.logger.warn(`Aviso no envio de stop para [${server.subdomain}]: ${err.message}`);
    }
  }
}
