import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { Server } from '../../database/entities/server.entity';
import { RconClient } from '../client/rcon-client';

@Injectable()
export class RconConnectionPool implements OnModuleDestroy {
  private readonly logger = new Logger(RconConnectionPool.name);
  private readonly clients = new Map<string, RconClient>();

  constructor(private readonly configService: AppConfigService) {}

  public getConnection(serverId: string): RconClient | undefined {
    return this.clients.get(serverId);
  }

  /**
   * Obtém conexão existente ou cria e autentica uma nova para o servidor (RF-RCON-03).
   * Resolução de DNS ClusterIP e credenciais de banco (PR-14).
   */
  public async getOrCreateConnection(
    server: Server,
  ): Promise<RconClient> {
    const existing = this.clients.get(server.id);
    if (existing && existing.isConnected()) {
      return existing;
    }

    if (existing) {
      existing.destroy();
      this.clients.delete(server.id);
    }

    const namespace = this.configService.kubernetes.namespace || 'minekubernetes';
    const serviceName = `mc-${server.subdomain}`;
    
    // Suporte para homelab / mock k8s rodando fora do cluster
    const isMock = this.configService.kubernetes.useMockDriver;
    const host = isMock
      ? '127.0.0.1'
      : `${serviceName}.${namespace}.svc.cluster.local`;

    const port = server.minecraft_settings?.rcon_port || 25575;
    const password =
      server.minecraft_settings?.rcon_password || 'minek8s-rcon-default';

    this.logger.log(
      `Criando nova conexão RCON no pool para [${server.id}] ${host}:${port}`,
    );

    const client = new RconClient({
      serverId: server.id,
      host,
      port,
      password,
      defaultTimeoutMs: 5000, // 5s padrão (RF-RCON-05)
      baseBackoffMs: 1000,
      maxBackoffMs: 15000,
      autoReconnect: true,
    });

    this.clients.set(server.id, client);

    try {
      await client.connect();
    } catch (err) {
      this.logger.warn(
        `Conexão inicial RCON pendente para servidor ${server.id}: ${(err as Error).message}`,
      );
    }

    return client;
  }

  /**
   * Disparado quando um servidor atinge o status READY
   */
  public async onServerReady(server: Server): Promise<void> {
    try {
      await this.getOrCreateConnection(server);
    } catch (err) {
      this.logger.warn(
        `Erro ao inicializar RCON para servidor READY ${server.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Disparado quando um servidor é parado, hibernado ou removido
   */
  public onServerStopped(serverId: string): void {
    const client = this.clients.get(serverId);
    if (client) {
      this.logger.log(`Fechando conexão RCON para servidor parado ${serverId}`);
      client.destroy();
      this.clients.delete(serverId);
    }
  }

  public removeConnection(serverId: string): void {
    this.onServerStopped(serverId);
  }

  public shutdownAll(): void {
    for (const [serverId, client] of this.clients.entries()) {
      client.destroy();
    }
    this.clients.clear();
  }

  onModuleDestroy(): void {
    this.shutdownAll();
  }
}
