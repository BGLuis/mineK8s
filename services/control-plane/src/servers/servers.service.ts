import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Server, ServerState } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { ServerAuditLog, ExecutionSource } from '@database/entities/server-audit-log.entity';
import { User } from '@database/entities/user.entity';
import { KubernetesService } from '@k8s/k8s.service';
import {
  CONSOLE_DRIVER_TOKEN,
  ConsoleDriver,
  CommandOptions,
} from '@console/console-driver.interface';
import { K8sLogStreamerService } from '@logging/k8s-log-streamer.service';
import { LogEntry } from '@logging/circular-log-buffer';
import { MinecraftSlpProbeService } from '../probes/minecraft-slp-probe.service';
import { GatewayIpcService } from '../gateway-ipc/gateway-ipc.service';
import { PlayerSessionsService } from '../gateway-ipc/player-sessions.service';
import { RouteAction } from '../gateway-ipc/gateway-ipc.interfaces';
import { CloudflareDnsDriver } from '../dns/drivers/cloudflare-dns.driver';

import { CreateServerDto, ServerType } from './dto/create-server.dto';
import { ServerDetailDto, ServerSummaryDto, toServerSettingsDto } from './dto/server-summary.dto';
import { UpdateServerDto } from './dto/update-server.dto';
import { UpdateVersionDto } from './dto/update-version.dto';
import { ServersBackupService } from './servers-backup.service';

const MEMORY_RESIZABLE_STATES: ServerState[] = ['STOPPED', 'READY', 'CRASHED'];

@Injectable()
export class ServersService {
  private readonly logger = new Logger(ServersService.name);

  constructor(
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    @InjectRepository(MinecraftServerSettings)
    private readonly settingsRepo: Repository<MinecraftServerSettings>,
    @InjectRepository(ServerAuditLog)
    private readonly auditRepo: Repository<ServerAuditLog>,
    private readonly k8sService: KubernetesService,
    @Inject(CONSOLE_DRIVER_TOKEN)
    private readonly consoleDriver: ConsoleDriver,
    private readonly logStreamer: K8sLogStreamerService,
    @Optional()
    private readonly backupService?: ServersBackupService,
    @Optional()
    private readonly gatewayIpcService?: GatewayIpcService,
    @Optional()
    private readonly slpProbeService?: MinecraftSlpProbeService,
    @Optional()
    private readonly dnsDriver?: CloudflareDnsDriver,
    @Optional()
    private readonly playerSessions?: PlayerSessionsService,
  ) {}

  async create(
    dto: CreateServerDto,
  ): Promise<{ id: string; name: string; subdomain: string; status: ServerState }> {
    const existing = await this.serverRepo.findOne({
      where: { subdomain: dto.subdomain },
    });
    if (existing) {
      throw new ConflictException(`Subdomain "${dto.subdomain}" is already in use`);
    }

    const accessPolicy = dto.access_policy || 'GROUP';

    const server = this.serverRepo.create({
      name: dto.name,
      subdomain: dto.subdomain,
      game_type: dto.game_type || 'minecraft',
      routing_model: dto.routing_model || 'sni-shared-port',
      allocated_port: dto.allocated_port ?? null,
      server_type: dto.server_type || ServerType.PAPER,
      game_version: dto.game_version || '1.20.4',
      modpack_id: dto.modpack_id ?? null,
      allocated_memory_mb: dto.allocated_memory_mb || 4096,
      auto_wake: dto.auto_wake ?? true,
      sleep_timeout_minutes: dto.sleep_timeout_minutes ?? 15,
      state: 'PROVISIONING',
      access_policy: accessPolicy,
    });

    const savedServer = await this.serverRepo.save(server);
    let savedSettings: MinecraftServerSettings | undefined;

    if (savedServer.game_type === 'minecraft') {
      const rconPassword = dto.minecraft_settings?.rcon_password || randomBytes(12).toString('hex');
      // RF-CF-02: Se access_policy for INTERNET, obriga online-mode=true
      const onlineMode =
        accessPolicy === 'INTERNET' ? true : (dto.minecraft_settings?.online_mode ?? false);
      const settings = this.settingsRepo.create({
        server_id: savedServer.id,
        motd: dto.minecraft_settings?.motd || `A MineKubernetes Server [${dto.name}]`,
        max_players: dto.minecraft_settings?.max_players ?? 20,
        difficulty: dto.minecraft_settings?.difficulty || 'normal',
        gamemode: dto.minecraft_settings?.gamemode || 'survival',
        hardcore: dto.minecraft_settings?.hardcore ?? false,
        pvp: dto.minecraft_settings?.pvp ?? true,
        spawn_protection: dto.minecraft_settings?.spawn_protection ?? 16,
        view_distance: dto.minecraft_settings?.view_distance ?? 10,
        simulation_distance: dto.minecraft_settings?.simulation_distance ?? 10,
        enable_rcon: true,
        rcon_port: 25575,
        rcon_password: rconPassword,
        enforce_secure_chat: dto.minecraft_settings?.enforce_secure_chat ?? false,
        online_mode: onlineMode,
      });
      savedSettings = await this.settingsRepo.save(settings);
    }

    try {
      await this.k8sService.provisionServer(savedServer, savedSettings);
      savedServer.state = 'STOPPED';
      await this.serverRepo.save(savedServer);
    } catch (err: any) {
      this.logger.error(
        `Failed to provision k8s resources for server "${savedServer.subdomain}": ${err.message}`,
        err.stack,
      );
      savedServer.state = 'FAILED';
      await this.serverRepo.save(savedServer);
      throw err;
    }

    return {
      id: savedServer.id,
      name: savedServer.name,
      subdomain: savedServer.subdomain,
      status: savedServer.state,
    };
  }

  async findAll(): Promise<ServerSummaryDto[]> {
    const servers = await this.serverRepo.find();
    let deployments: any[] = [];
    try {
      deployments = await this.k8sService.listDeployments();
    } catch (err: any) {
      this.logger.warn(`Could not list k8s deployments: ${err.message}`);
    }

    const deploymentMap = new Map(deployments.map((d) => [d.name, d]));

    return servers.map((s) => {
      const depName = `mc-${s.subdomain}`;
      const dep = deploymentMap.get(depName);
      return {
        id: s.id,
        name: s.name,
        subdomain: s.subdomain,
        game_type: s.game_type,
        routing_model: s.routing_model,
        server_type: s.server_type,
        game_version: s.game_version,
        allocated_memory_mb: s.allocated_memory_mb,
        allocated_port: s.allocated_port,
        state: s.state,
        access_policy: s.access_policy,
        is_maintenance: s.is_maintenance,
        auto_wake: s.auto_wake,
        sleep_timeout_minutes: s.sleep_timeout_minutes,
        created_at: s.created_at,
        updated_at: s.updated_at,
        replicas: dep?.replicas ?? 0,
        ready_replicas: dep?.status?.readyReplicas ?? 0,
        players_online: this.playerSessions?.count(s.id) ?? 0,
      };
    });
  }

  async findOne(id: string): Promise<ServerDetailDto> {
    const server = await this.serverRepo.findOne({
      where: { id },
      relations: {
        minecraft_settings: true,
      },
    });

    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    let dep = null;
    try {
      dep = await this.k8sService.getServerDeployment(server);
    } catch (err: any) {
      this.logger.warn(`Failed to get k8s deployment for ${server.subdomain}: ${err.message}`);
    }

    return {
      id: server.id,
      name: server.name,
      subdomain: server.subdomain,
      game_type: server.game_type,
      routing_model: server.routing_model,
      server_type: server.server_type,
      game_version: server.game_version,
      allocated_memory_mb: server.allocated_memory_mb,
      allocated_port: server.allocated_port,
      state: server.state,
      access_policy: server.access_policy,
      is_maintenance: server.is_maintenance,
      auto_wake: server.auto_wake,
      sleep_timeout_minutes: server.sleep_timeout_minutes,
      created_at: server.created_at,
      updated_at: server.updated_at,
      replicas: dep?.replicas ?? 0,
      ready_replicas: dep?.status?.readyReplicas ?? 0,
      players_online: this.playerSessions?.count(server.id) ?? 0,
      settings: server.minecraft_settings
        ? toServerSettingsDto(server.minecraft_settings)
        : undefined,
    };
  }

  async getPlayers(id: string): Promise<{
    online: number;
    max: number;
    players: { nick: string; ip: string; connectedAt: Date }[];
  }> {
    const server = await this.serverRepo.findOne({
      where: { id },
      relations: {
        minecraft_settings: true,
      },
    });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    const sessions = this.playerSessions?.list(id) ?? [];
    return {
      online: sessions.length,
      max: server.minecraft_settings?.max_players ?? 20,
      players: sessions.map(({ nick, ip, connectedAt }) => ({ nick, ip, connectedAt })),
    };
  }

  async start(id: string): Promise<{ message: string }> {
    const server = await this.serverRepo.findOne({ where: { id } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    if (server.state === 'READY' || server.state === 'STARTING') {
      return { message: 'Instance is already running or starting' };
    }

    server.state = 'STARTING';
    await this.serverRepo.save(server);
    await this.k8sService.startServer(server);

    return { message: 'Instance starting' };
  }

  async stop(id: string): Promise<{ message: string }> {
    const server = await this.serverRepo.findOne({ where: { id } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    server.state = 'STOPPED';
    await this.serverRepo.save(server);
    await this.k8sService.stopServer(server);

    return { message: 'Instance stopping' };
  }

  async restart(id: string): Promise<{ message: string }> {
    const server = await this.serverRepo.findOne({ where: { id } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    if (server.state !== 'READY' && server.state !== 'CRASHED') {
      throw new ConflictException(
        `Only a running server can be restarted (current state: ${server.state})`,
      );
    }

    server.state = 'STOPPING';
    await this.serverRepo.save(server);
    await this.k8sService.restartServer(server);
    server.state = 'STARTING';
    await this.serverRepo.save(server);

    return { message: 'Instance restarting' };
  }

  async update(id: string, dto: UpdateServerDto) {
    const server = await this.serverRepo.findOne({
      where: { id },
      relations: {
        minecraft_settings: true,
      },
    });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    const changes = Object.entries(dto).filter(([, value]) => value !== undefined);
    if (changes.length === 0) {
      throw new BadRequestException('Provide at least one field to update');
    }
    if (server.access_policy === 'INTERNET' && dto.access_policy) {
      throw new ConflictException(
        'Server is published on the internet: unpublish it with DELETE /api/servers/:id/publish before changing the policy',
      );
    }

    const memoryChanged =
      dto.allocated_memory_mb !== undefined &&
      dto.allocated_memory_mb !== server.allocated_memory_mb;
    if (memoryChanged && !MEMORY_RESIZABLE_STATES.includes(server.state)) {
      throw new ConflictException(
        `Memory can only change while the server is stopped or running (current state: ${server.state})`,
      );
    }

    Object.assign(server, Object.fromEntries(changes));
    await this.serverRepo.save(server);

    if (memoryChanged) {
      await this.applyMemory(server);
    }
    await this.republishRoute(server);

    return this.findOne(id);
  }

  /** The JVM reads -Xmx only at boot, so a running server is stopped gracefully and started on the new Deployment. */
  private async applyMemory(server: Server): Promise<void> {
    if (server.state === 'STOPPED') {
      await this.k8sService.applyDeployment(server, server.minecraft_settings);
      return;
    }
    server.state = 'STOPPING';
    await this.serverRepo.save(server);
    await this.k8sService.stopServer(server);
    server.state = 'STARTING';
    await this.serverRepo.save(server);
    await this.k8sService.applyDeployment(server, server.minecraft_settings);
  }

  async delete(id: string): Promise<{ message: string }> {
    const server = await this.serverRepo.findOne({ where: { id } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    await this.k8sService.deprovisionServer(server);
    await this.serverRepo.remove(server);

    return { message: 'Instance removed' };
  }

  async updateDomain(id: string, domain: string): Promise<{ message: string }> {
    const server = await this.serverRepo.findOne({ where: { id } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    const conflict = await this.serverRepo.findOne({ where: { subdomain: domain } });
    if (conflict && conflict.id !== id) {
      throw new ConflictException(`Subdomain "${domain}" is already in use`);
    }

    server.subdomain = domain;
    await this.serverRepo.save(server);

    return { message: 'Domain updated' };
  }

  async getLogs(id: string, tail: number = 150): Promise<{ logs: string; lines: LogEntry[] }> {
    const server = await this.serverRepo.findOne({ where: { id } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    const buffer = this.logStreamer.getBuffer(id);
    const history = buffer.getHistory();
    const sliced = tail > 0 ? history.slice(-tail) : history;
    const logs =
      sliced.length > 0
        ? sliced
            .map((entry) => `[${entry.timestamp}] [${entry.level}]: ${entry.message}`)
            .join('\n')
        : `[MineKubernetes Control Plane] Logs for ${server.subdomain} (tail ${tail})\nServer is ${server.state}`;

    return {
      logs,
      lines: sliced,
    };
  }

  async sendCommand(
    id: string,
    command: string,
    options?: CommandOptions & {
      user?: User;
      ipAddress?: string;
      source?: ExecutionSource;
    },
  ): Promise<{
    success: boolean;
    serverId: string;
    command: string;
    response: string;
    executionTimeMs: number;
  }> {
    const server = await this.serverRepo.findOne({
      where: { id },
      relations: {
        minecraft_settings: true,
      },
    });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    const startTime = Date.now();
    let response = '';
    let isError = false;

    try {
      response = await this.consoleDriver.sendCommand(server, command, options);
    } catch (err) {
      response = (err as Error).message;
      isError = true;
      throw err;
    } finally {
      const durationMs = Date.now() - startTime;
      await this.auditRepo.save({
        server_id: server.id,
        user_id: options?.user?.id ?? null,
        command,
        execution_source: options?.source || 'REST_API',
        ip_address: options?.ipAddress || null,
        response: response ? response.substring(0, 500) : null,
        executed_at: new Date(),
      });
    }

    const durationMs = Date.now() - startTime;
    return {
      success: !isError,
      serverId: server.id,
      command,
      response,
      executionTimeMs: durationMs,
    };
  }

  /**
   * Executa pipeline transacional de atualização de versão com backup pre-update e rollback (RF-STO-13).
   */
  async updateVersion(
    id: string,
    dto: UpdateVersionDto,
  ): Promise<{ message: string; version: string; rolledBack: boolean }> {
    const server = await this.serverRepo.findOne({
      where: { id },
      relations: {
        minecraft_settings: true,
      },
    });

    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    if (server.state === 'UPDATING') {
      throw new ConflictException(
        `Server [${server.subdomain}] is already being updated (state: UPDATING)`,
      );
    }

    const previousVersion = server.game_version;
    const previousModpack = server.modpack_id;
    const previousType = server.server_type;
    const previousState = server.state;

    this.logger.log(
      `Iniciando pipeline de atualização para [${server.subdomain}]: ${previousVersion} -> ${dto.game_version} (RF-STO-13)`,
    );

    // 1. Transição de estado para UPDATING e notificação ao Gateway L7
    server.state = 'UPDATING';
    await this.serverRepo.save(server);
    this.notifyGateway(server, 'UPDATING');

    // 2. Parada graciosa da JVM ativa caso o servidor estivesse rodando
    if (previousState === 'READY' || previousState === 'STARTING') {
      await this.k8sService.stopServer(server);
    }

    // 3. Backup Preventivo Obrigatório (pre-update)
    let backupPath: string;
    if (this.backupService) {
      try {
        backupPath = await this.backupService.createPreUpdateBackup(server);
      } catch (err: any) {
        this.logger.error(
          `Falha ao gerar backup pre-update para [${server.subdomain}]: ${err.message}`,
        );
        server.state = previousState;
        await this.serverRepo.save(server);
        this.notifyGateway(server, previousState);
        throw new BadRequestException(
          `Failed to create the mandatory pre-update backup: ${err.message}`,
        );
      }
    } else {
      backupPath = '/dummy/backup';
    }

    try {
      // 4. Purga segura de mods/ para modpacks ou sob solicitação (RF-STO-13)
      if (dto.purge_mods !== false && this.backupService) {
        await this.backupService.purgeModsDirectory(server);
      }

      // 5. Aplicação da nova versão nos metadados
      server.game_version = dto.game_version;
      if (dto.server_type) {
        server.server_type = dto.server_type;
      }
      if (dto.modpack_id !== undefined) {
        server.modpack_id = dto.modpack_id;
      }
      await this.serverRepo.save(server);

      // Re-provisiona manifesto com novos recursos/imagem no K8s
      await this.k8sService.provisionServer(server, server.minecraft_settings);

      // 6. Inicia o pod na nova versão
      server.state = 'STARTING';
      await this.serverRepo.save(server);
      this.notifyGateway(server, 'STARTING');
      await this.k8sService.startServer(server);

      // 7. Health Watchdog / Verificação de boot
      const probePassed = await this.verifyPostUpdateBoot(server);

      if (probePassed) {
        this.logger.log(
          `Nova versão [${dto.game_version}] iniciada com sucesso em [${server.subdomain}]. Status: READY`,
        );
        server.state = 'READY';
        await this.serverRepo.save(server);
        this.notifyGateway(server, 'READY');

        return {
          message: 'Version update completed successfully',
          version: server.game_version,
          rolledBack: false,
        };
      }

      // Boot falhou: dispara Rollback Automático Transacional (RF-STO-13)
      this.logger.error(
        `Boot da nova versão [${dto.game_version}] falhou para [${server.subdomain}]. Disparando Rollback Automático (RF-STO-13)...`,
      );
      return await this.performRollback(
        server,
        backupPath,
        previousVersion,
        previousModpack,
        previousType,
      );
    } catch (err: any) {
      this.logger.error(
        `Erro durante pipeline de atualização de [${server.subdomain}]: ${err.message}. Disparando Rollback...`,
      );
      return await this.performRollback(
        server,
        backupPath,
        previousVersion,
        previousModpack,
        previousType,
      );
    }
  }

  private async verifyPostUpdateBoot(server: Server): Promise<boolean> {
    if (!this.slpProbeService) {
      return true;
    }

    try {
      const probe = await this.slpProbeService.probe(
        '127.0.0.1',
        server.allocated_port || 25565,
        3000,
      );
      return probe.ready;
    } catch {
      return false;
    }
  }

  private async performRollback(
    server: Server,
    backupPath: string,
    previousVersion: string,
    previousModpack: string | null,
    previousType: string,
  ): Promise<{ message: string; version: string; rolledBack: boolean }> {
    try {
      // 1. Para pod da nova versão com falha
      await this.k8sService.stopServer(server);

      // 2. Restaura arquivos do backup pre-update
      if (this.backupService) {
        await this.backupService.restorePreUpdateBackup(server, backupPath);
      }

      // 3. Reverte atributos de banco
      server.game_version = previousVersion;
      server.modpack_id = previousModpack;
      server.server_type = previousType;
      server.state = 'STARTING';
      await this.serverRepo.save(server);
      this.notifyGateway(server, 'STARTING');

      // 4. Re-provisiona manifesto anterior e inicia
      await this.k8sService.provisionServer(server, server.minecraft_settings);
      await this.k8sService.startServer(server);

      server.state = 'READY';
      await this.serverRepo.save(server);
      this.notifyGateway(server, 'READY');

      this.logger.log(
        `Rollback automático concluído com sucesso para [${server.subdomain}]. Versão estável anterior restaurada: ${previousVersion}`,
      );

      return {
        message: 'New version failed. Automatic rollback completed successfully.',
        version: previousVersion,
        rolledBack: true,
      };
    } catch (rollbackErr: any) {
      this.logger.error(
        `Falha catastrófica durante rollback de [${server.subdomain}]: ${rollbackErr.message}`,
      );
      server.state = 'FAILED';
      await this.serverRepo.save(server);
      this.notifyGateway(server, 'FAILED');
      throw new Error(`Failure during version rollback: ${rollbackErr.message}`);
    }
  }

  async publishServer(id: string): Promise<{
    id: string;
    subdomain: string;
    access_policy: string;
    online_mode: boolean;
    srv_record: string;
  }> {
    const server = await this.serverRepo.findOne({
      where: { id },
      relations: {
        minecraft_settings: true,
      },
    });
    if (!server) {
      throw new NotFoundException(`Server with ID ${id} not found`);
    }

    // RF-CF-02: Mundo INTERNET obriga online-mode=true
    if (server.minecraft_settings) {
      server.minecraft_settings.online_mode = true;
      await this.settingsRepo.save(server.minecraft_settings);
    }

    // RF-CF-01: Nova política INTERNET explícita no servers
    server.access_policy = 'INTERNET';
    const updatedServer = await this.serverRepo.save(server);

    const rootDomain = this.dnsDriver?.getRootDomain() || 'minek8s.net';
    const srvName = `${server.subdomain}.${rootDomain}`;
    const srvTarget = `${server.subdomain}.${rootDomain}`;
    const publicPort = 25566;

    // RF-CF-05 e RF-CF-07: Cria registro SRV no Cloudflare
    if (this.dnsDriver) {
      try {
        await this.dnsDriver.upsertSrvRecord(srvName, srvTarget, publicPort);
      } catch (err: any) {
        this.logger.error(`Erro ao criar registro SRV para ${srvName}: ${err.message}`, err.stack);
        throw new Error(`Error creating SRV record on Cloudflare: ${err.message}`);
      }
    }

    // Notificar Gateway L7 sobre a política INTERNET
    await this.republishRoute(updatedServer);

    // Auditoria
    await this.auditRepo.save(
      this.auditRepo.create({
        server_id: server.id,
        command: 'PUBLISH_SERVER',
        execution_source: 'REST_API',
        response: `Server ${server.subdomain} published on the internet (online-mode=true, SRV: ${srvName})`,
      }),
    );

    return {
      id: updatedServer.id,
      subdomain: updatedServer.subdomain,
      access_policy: updatedServer.access_policy,
      online_mode: true,
      srv_record: `_minecraft._tcp.${srvName} -> ${srvTarget}:${publicPort}`,
    };
  }

  async unpublishServer(id: string): Promise<{
    id: string;
    subdomain: string;
    access_policy: string;
  }> {
    const server = await this.serverRepo.findOne({
      where: { id },
      relations: {
        minecraft_settings: true,
      },
    });
    if (!server) {
      throw new NotFoundException(`Server with ID ${id} not found`);
    }

    const rootDomain = this.dnsDriver?.getRootDomain() || 'minek8s.net';
    const srvFullName = `_minecraft._tcp.${server.subdomain}.${rootDomain}`;

    // RF-CF-07: Remove registro SRV do Cloudflare
    if (this.dnsDriver) {
      try {
        await this.dnsDriver.deleteRecordByNameAndType(srvFullName, 'SRV');
      } catch (err: any) {
        this.logger.warn(`Erro ao remover registro SRV ${srvFullName}: ${err.message}`);
      }
    }

    // Retorna para política padrão Zero-Trust privada
    server.access_policy = 'GROUP';
    const updatedServer = await this.serverRepo.save(server);

    // Notificar Gateway L7
    await this.republishRoute(updatedServer);

    // Auditoria
    await this.auditRepo.save(
      this.auditRepo.create({
        server_id: server.id,
        command: 'UNPUBLISH_SERVER',
        execution_source: 'REST_API',
        response: `Server ${server.subdomain} unpublished from the internet (access_policy=GROUP)`,
      }),
    );

    return {
      id: updatedServer.id,
      subdomain: updatedServer.subdomain,
      access_policy: updatedServer.access_policy,
    };
  }

  /** O Gateway só enxerga mudanças de política, manutenção e auto-wake por um UPSERT de rota; STATUS_CHANGE não basta. */
  private async republishRoute(server: Server): Promise<void> {
    try {
      await this.gatewayIpcService?.publishRoute(server.id);
    } catch (err: any) {
      this.logger.warn(
        `Falha ao publicar rota atualizada de [${server.subdomain}] no Gateway: ${err.message}`,
      );
    }
  }

  private notifyGateway(server: Server, status: ServerState): void {
    if (!this.gatewayIpcService) {
      return;
    }
    try {
      this.gatewayIpcService.broadcastRouteUpdate({
        action: RouteAction.STATUS_CHANGE,
        server_id: server.id,
        subdomain: server.subdomain,
        target_ip_port: this.gatewayIpcService.routeTarget(server),
        status: status.toUpperCase(),
        access_policy: server.access_policy || 'GROUP',
        allowed_group_ids: [],
        allowed_user_ids: [],
        proxy_protocol: Boolean((server.minecraft_settings as any)?.proxy_protocol),
        game_type: server.game_type || 'MINECRAFT',
        routing_model: server.routing_model || 'VirtualHost',
        listen_port: server.allocated_port || 25565,
        auto_wake: server.auto_wake !== false,
      });
    } catch (err: any) {
      this.logger.warn(
        `Erro ao notificar Gateway sobre status ${status} de [${server.subdomain}]: ${err.message}`,
      );
    }
  }
}
