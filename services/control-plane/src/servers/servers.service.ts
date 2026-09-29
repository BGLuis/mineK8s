import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Server, ServerState } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import {
  ServerAuditLog,
  ExecutionSource,
} from '@database/entities/server-audit-log.entity';
import { User } from '@database/entities/user.entity';
import { KubernetesService } from '@k8s/k8s.service';
import {
  CONSOLE_DRIVER_TOKEN,
  ConsoleDriver,
  CommandOptions,
} from '@console/console-driver.interface';
import { K8sLogStreamerService } from '@logging/k8s-log-streamer.service';
import { LogEntry } from '@logging/circular-log-buffer';

import { CreateServerDto, ServerType } from './dto/create-server.dto';
import { ServerSummaryDto } from './dto/server-summary.dto';

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
  ) {}

  async create(dto: CreateServerDto): Promise<{ id: string; name: string; subdomain: string; status: ServerState }> {
    const existing = await this.serverRepo.findOne({
      where: { subdomain: dto.subdomain },
    });
    if (existing) {
      throw new ConflictException(`Subdomain "${dto.subdomain}" is already in use`);
    }

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
    });

    const savedServer = await this.serverRepo.save(server);
    let savedSettings: MinecraftServerSettings | undefined;

    if (savedServer.game_type === 'minecraft') {
      const rconPassword =
        dto.minecraft_settings?.rcon_password || randomBytes(12).toString('hex');
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
        online_mode: dto.minecraft_settings?.online_mode ?? false,
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

    const deploymentMap = new Map(
      deployments.map((d) => [d.name, d]),
    );

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
        is_maintenance: s.is_maintenance,
        auto_wake: s.auto_wake,
        sleep_timeout_minutes: s.sleep_timeout_minutes,
        created_at: s.created_at,
        updated_at: s.updated_at,
        replicas: dep?.replicas ?? 0,
        ready_replicas: dep?.status?.readyReplicas ?? 0,
      };
    });
  }

  async findOne(id: string): Promise<ServerSummaryDto & { settings?: MinecraftServerSettings }> {
    const server = await this.serverRepo.findOne({
      where: { id },
      relations: ['minecraft_settings'],
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
      is_maintenance: server.is_maintenance,
      auto_wake: server.auto_wake,
      sleep_timeout_minutes: server.sleep_timeout_minutes,
      created_at: server.created_at,
      updated_at: server.updated_at,
      replicas: dep?.replicas ?? 0,
      ready_replicas: dep?.status?.readyReplicas ?? 0,
      settings: server.minecraft_settings,
    };
  }

  async start(id: string): Promise<{ message: string }> {
    const server = await this.serverRepo.findOne({ where: { id } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    if (server.state === 'READY' || server.state === 'STARTING') {
      return { message: 'Instância já está em execução ou iniciando' };
    }

    server.state = 'STARTING';
    await this.serverRepo.save(server);
    await this.k8sService.startServer(server);

    return { message: 'Instância iniciando' };
  }

  async stop(id: string): Promise<{ message: string }> {
    const server = await this.serverRepo.findOne({ where: { id } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    server.state = 'STOPPED';
    await this.serverRepo.save(server);
    await this.k8sService.stopServer(server);

    return { message: 'Instância parando' };
  }

  async delete(id: string): Promise<{ message: string }> {
    const server = await this.serverRepo.findOne({ where: { id } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    await this.k8sService.deprovisionServer(server);
    await this.serverRepo.remove(server);

    return { message: 'Instância removida' };
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

    return { message: 'Domínio atualizado' };
  }

  async getLogs(
    id: string,
    tail: number = 150,
  ): Promise<{ logs: string; lines: LogEntry[] }> {
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
      relations: ['minecraft_settings'],
    });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    const startTime = Date.now();
    let response = '';
    let isError = false;

    try {
      response = await this.consoleDriver.sendCommand(
        server,
        command,
        options,
      );
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
}
