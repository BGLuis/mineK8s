import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { MinecraftServerSettings } from '../../database/entities/minecraft-server-settings.entity';
import { Server } from '../../database/entities/server.entity';
import { resolveRconCredentials } from '../../k8s/server-properties';
import { serverWorkloadName } from '../../k8s/resource-names';
import { RconClient } from '../client/rcon-client';

@Injectable()
export class RconConnectionPool implements OnModuleDestroy {
  private readonly logger = new Logger(RconConnectionPool.name);
  private readonly clients = new Map<string, RconClient>();
  private readonly pending = new Map<string, Promise<RconClient>>();

  constructor(
    private readonly configService: AppConfigService,
    @Optional()
    @InjectRepository(MinecraftServerSettings)
    private readonly settingsRepo?: Repository<MinecraftServerSettings>,
  ) {}

  public getConnection(serverId: string): RconClient | undefined {
    return this.clients.get(serverId);
  }

  /**
   * Obtém conexão existente ou cria e autentica uma nova para o servidor (RF-RCON-03).
   * Resolução de DNS ClusterIP e credenciais de banco (PR-14).
   */
  public async getOrCreateConnection(server: Server): Promise<RconClient> {
    // Callers that arrive while a connection is being opened share it: each one would otherwise
    // destroy the client the previous one is still authenticating.
    const opening = this.pending.get(server.id);
    if (opening) {
      return opening;
    }

    const creation = this.openConnection(server).finally(() => this.pending.delete(server.id));
    this.pending.set(server.id, creation);
    return creation;
  }

  private async openConnection(server: Server): Promise<RconClient> {
    const existing = this.clients.get(server.id);
    if (existing && existing.isConnected()) {
      return existing;
    }

    if (existing) {
      existing.destroy();
      this.clients.delete(server.id);
    }

    const namespace = this.configService.kubernetes.namespace || 'minekubernetes';
    const serviceName = serverWorkloadName(server.resource_name);

    // Suporte para homelab / mock k8s rodando fora do cluster
    const isMock = this.configService.kubernetes.useMockDriver;
    const host = isMock ? '127.0.0.1' : `${serviceName}.${namespace}.svc.cluster.local`;

    // Servers loaded without the relation would otherwise fall back to the default password, which
    // the server rejects: the RCON password lives in minecraft_server_settings.
    const settings =
      server.minecraft_settings ?? (await this.settingsRepo?.findOneBy({ server_id: server.id }));
    const { port, password } = resolveRconCredentials(settings ?? undefined);

    this.logger.log(`Criando nova conexão RCON no pool para [${server.id}] ${host}:${port}`);

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
