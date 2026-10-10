import { randomUUID } from 'crypto';
import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, Subject } from 'rxjs';
import { Repository } from 'typeorm';

import { Server } from '@database/entities/server.entity';
import { ServerGroup } from '@database/entities/server-group.entity';
import { User } from '@database/entities/user.entity';
import { UserGroup } from '@database/entities/user-group.entity';
import { UserServerAccess } from '@database/entities/user-server-access.entity';

import { AppConfigService } from '@config/app-config.service';
import { ManifestBuilder } from '@k8s/manifest-builder';
import {
  NETWORK_IDENTITY_PROVIDER,
  NetworkIdentityProvider,
} from '../tailscale/identity/network-identity-provider.interface';
import { KubernetesService } from '@k8s/k8s.service';
import { effectiveAccessPolicy } from '../tailscale/decision/effective-access-policy';
import { ServerIconService } from '../servers/server-icon.service';
import { PlayerSessionsService } from './player-sessions.service';
import {
  Empty,
  GatewayCommand,
  GatewayCommandResult,
  ResolvePlayerRequest,
  ResolvePlayerResponse,
  RevokeSessionRequest,
  RevokeSessionResponse,
  RouteAction,
  RouteUpdateEvent,
  RoutingSnapshotResponse,
  SessionEventType,
  SessionLifecycleEvent,
} from './gateway-ipc.interfaces';

/** Prazo para o Gateway responder um comando; derrubar sockets é imediato, então passar disso é falha. */
const COMMAND_TIMEOUT_MS = 5000;

interface CommandChannel {
  send(command: GatewayCommand): void;
}

interface PendingCommand {
  channel: CommandChannel;
  resolve: (result: GatewayCommandResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

@Injectable()
export class GatewayIpcService {
  private readonly logger = new Logger(GatewayIpcService.name);
  private readonly routeUpdates$ = new Subject<RouteUpdateEvent>();
  private readonly commandChannels = new Set<CommandChannel>();
  private readonly pendingCommands = new Map<string, PendingCommand>();

  constructor(
    @InjectRepository(Server)
    private readonly serverRepository: Repository<Server>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(ServerGroup)
    private readonly serverGroupRepository: Repository<ServerGroup>,
    @InjectRepository(UserServerAccess)
    private readonly userServerAccessRepository: Repository<UserServerAccess>,
    @InjectRepository(UserGroup)
    private readonly userGroupRepository: Repository<UserGroup>,
    @Optional()
    @Inject(NETWORK_IDENTITY_PROVIDER)
    private readonly identityProvider?: NetworkIdentityProvider,
    @Optional()
    private readonly k8sService?: KubernetesService,
    @Optional()
    private readonly playerSessions?: PlayerSessionsService,
    private readonly configService?: AppConfigService,
    @Optional()
    private readonly icons?: ServerIconService,
  ) {}

  /**
   * Fornece o Observable para o stream contínuo de atualizações de rotas (StreamRouteUpdates).
   */
  getRouteUpdatesStream(): Observable<RouteUpdateEvent> {
    return this.routeUpdates$.asObservable();
  }

  /**
   * Emite uma mutação de rota para todos os Gateways conectados.
   */
  broadcastRouteUpdate(event: RouteUpdateEvent): void {
    this.logger.debug(
      `Transmitindo RouteUpdateEvent via gRPC: action=${RouteAction[event.action]} server=${event.server_id} sub=${event.subdomain}`,
    );
    this.routeUpdates$.next(event);
  }

  /**
   * Constrói o snapshot completo de rotas ativas para sincronização inicial no boot do Gateway (RF-GW-16).
   */
  async getInitialRoutingSnapshot(_empty?: Empty): Promise<RoutingSnapshotResponse> {
    this.logger.log('Recebida requisição de snapshot inicial de rotas (GetInitialRoutingSnapshot)');

    const servers = await this.serverRepository.find({
      relations: {
        minecraft_settings: true,
      },
    });

    const routes: RouteUpdateEvent[] = [];

    for (const server of servers) {
      routes.push(await this.buildUpsertEvent(server));
    }

    this.logger.log(
      `Snapshot inicial construído com sucesso: ${routes.length} rotas enviadas ao Gateway`,
    );
    return { routes };
  }

  /**
   * Reenvia ao Gateway a rota completa do servidor (política, grupos, usuários, auto-wake).
   * STATUS_CHANGE só atualiza estado e destino, então mudanças de configuração precisam de UPSERT.
   */
  async publishRoute(serverId: string): Promise<void> {
    const server = await this.serverRepository.findOne({
      where: { id: serverId },
      relations: {
        minecraft_settings: true,
      },
    });
    if (!server) {
      return;
    }
    this.broadcastRouteUpdate(await this.buildUpsertEvent(server));
  }

  /** O destino de toda rota publicada ao Gateway, seja por UPSERT ou STATUS_CHANGE, sai daqui. */
  routeTarget(server: Server): string {
    if (!this.configService) {
      throw new Error('GatewayIpcService needs AppConfigService to build route targets');
    }
    return ManifestBuilder.routeTarget(server, this.configService);
  }

  private async buildUpsertEvent(server: Server): Promise<RouteUpdateEvent> {
    const serverGroups = await this.serverGroupRepository.find({
      where: { server_id: server.id },
    });
    const userAccesses = await this.userServerAccessRepository.find({
      where: { server_id: server.id },
    });

    return {
      action: RouteAction.UPSERT,
      server_id: server.id,
      subdomain: server.subdomain,
      target_ip_port: this.routeTarget(server),
      status: String(server.state || 'STOPPED').toUpperCase(),
      access_policy: effectiveAccessPolicy(server),
      allowed_group_ids: serverGroups.map((sg) => sg.group_id),
      allowed_user_ids: userAccesses.map((ua) => ua.user_id),
      proxy_protocol: Boolean((server.minecraft_settings as any)?.proxy_protocol),
      game_type: server.game_type || 'MINECRAFT',
      routing_model: server.routing_model || 'VirtualHost',
      listen_port: server.allocated_port || 25565,
      auto_wake: server.auto_wake !== false,
      favicon: (await this.icons?.dataUri(server)) ?? '',
      name: server.name,
      max_players: server.minecraft_settings?.max_players ?? 0,
      language: server.minecraft_settings?.language ?? 'pt-BR',
    };
  }

  /**
   * Resolução pontual sob demanda de identidade do jogador (WhoIs -> User, Grupos, Nick).
   */
  async resolvePlayerIdentity(req: ResolvePlayerRequest): Promise<ResolvePlayerResponse> {
    this.logger.debug(
      `Resolvendo identidade gRPC: tailscale_user_id=${req.tailscale_user_id}, node_id=${req.node_id}, ip=${req.client_ip}`,
    );

    let user: User | null = null;

    if (req.tailscale_user_id) {
      user = await this.userRepository.findOne({
        where: { tailscale_user_id: req.tailscale_user_id },
      });
    }

    if (!user && req.node_id) {
      user = await this.findUserByNodeId(req.node_id);
    }

    if (!user && req.client_ip && this.identityProvider) {
      try {
        const netId = await this.identityProvider.resolveIdentity(req.client_ip);
        if (netId) {
          if (netId.userId) {
            user = await this.userRepository.findOne({
              where: { tailscale_user_id: netId.userId },
            });
          }
          if (!user && netId.nodeId) {
            user = await this.findUserByNodeId(netId.nodeId);
          }
        }
      } catch (err: any) {
        this.logger.warn(
          `Falha na resolução de identidade de rede para IP ${req.client_ip}: ${err.message}`,
        );
      }
    }

    if (!user) {
      return {
        found: false,
        user_id: '',
        minecraft_nick: '',
        role: 'PLAYER',
        group_ids: [],
        is_active: false,
        is_mojang_verified: false,
      };
    }

    const userGroups = await this.userGroupRepository.find({
      where: { user_id: user.id },
    });

    return {
      found: true,
      user_id: user.id,
      minecraft_nick: user.minecraft_nick,
      role: user.role,
      group_ids: userGroups.map((ug) => ug.group_id),
      is_active: true,
      is_mojang_verified: (user as any).is_mojang_verified || false,
    };
  }

  /** O `where` tipado pela entidade faz o compilador acusar se a coluna do dispositivo mudar de nome. */
  private findUserByNodeId(nodeId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { devices: { node_id: nodeId } } });
  }

  /**
   * Processa eventos de ciclo de vida de sessão streaming vindos do Gateway.
   */
  async handleSessionEvent(event: SessionLifecycleEvent): Promise<void> {
    this.logger.log(
      `Evento de sessão recebido do Gateway: [${event.event_type}] user=${event.minecraft_nick} server=${event.server_id} ip=${event.client_ip}`,
    );

    // O prost não serializa o zero do proto3 e o proto-loader não preenche defaults: CONNECTED (0) chega sem o campo.
    switch (event.event_type ?? SessionEventType.CONNECTED) {
      case SessionEventType.WAKE_REQUESTED:
        await this.handleWakeRequest(event.server_id);
        break;
      case SessionEventType.CONNECTED:
        this.playerSessions?.connected(event);
        break;
      case SessionEventType.DISCONNECTED:
        this.playerSessions?.disconnected(event);
        break;
    }
  }

  /** Com o stream fechado o Gateway não reporta mais nada; descarta o estado até ele reenviar as sessões abertas. */
  handleSessionStreamClosed(): void {
    this.playerSessions?.clearAll();
  }

  /**
   * Processa requisição de Auto-Wake sob demanda (RF-GW-10, RF-ARQ-27).
   */
  async handleWakeRequest(serverId: string): Promise<void> {
    const server = await this.serverRepository.findOne({
      where: { id: serverId },
      relations: {
        minecraft_settings: true,
      },
    });

    if (!server) {
      this.logger.warn(`Wake requested for non-existent server ID: ${serverId}`);
      return;
    }

    if (server.auto_wake === false) {
      this.logger.warn(
        `Wake requested for server [${server.subdomain}], but auto_wake is disabled.`,
      );
      return;
    }

    if (server.state === 'STOPPED') {
      this.logger.log(
        `Wake requested for hibernating server [${server.subdomain}] (RF-GW-10). Scaling up pod...`,
      );
      server.state = 'STARTING';
      server.last_player_active_at = new Date();
      await this.serverRepository.save(server);

      this.broadcastRouteUpdate({
        action: RouteAction.STATUS_CHANGE,
        server_id: server.id,
        subdomain: server.subdomain,
        target_ip_port: this.routeTarget(server),
        status: 'STARTING',
        access_policy: server.access_policy || 'GROUP',
        allowed_group_ids: [],
        allowed_user_ids: [],
        proxy_protocol: Boolean((server.minecraft_settings as any)?.proxy_protocol),
        game_type: server.game_type || 'MINECRAFT',
        routing_model: server.routing_model || 'VirtualHost',
        listen_port: server.allocated_port || 25565,
        auto_wake: true,
      });

      if (this.k8sService) {
        try {
          await this.k8sService.startServer(server);
          this.logger.log(`Pod for server [${server.subdomain}] started successfully via K8s.`);
        } catch (err: any) {
          this.logger.error(`Failed to start pod for server [${server.subdomain}]: ${err.message}`);
        }
      }
    } else {
      this.logger.debug(
        `Server [${server.subdomain}] is already in state ${server.state}, ignoring wake request.`,
      );
    }
  }

  /**
   * Registra o canal de comandos de um Gateway conectado (StreamCommands). Os comandos saem pelo Observable
   * devolvido e os resultados entram por `results`. Quando o Gateway se desconecta, os comandos que ele ainda
   * não respondeu falham.
   */
  openCommandStream(results: Observable<GatewayCommandResult>): Observable<GatewayCommand> {
    return new Observable<GatewayCommand>((subscriber) => {
      const channel: CommandChannel = { send: (command) => subscriber.next(command) };
      this.commandChannels.add(channel);
      this.logger.log(
        `Canal de comandos do Gateway registrado (${this.commandChannels.size} ativo(s))`,
      );

      const incoming = results.subscribe({
        next: (result) => this.settleCommand(channel, result),
        error: () => subscriber.complete(),
        complete: () => subscriber.complete(),
      });

      return () => {
        incoming.unsubscribe();
        this.commandChannels.delete(channel);
        this.failPendingCommands(
          channel,
          new ServiceUnavailableException('Gateway disconnected before answering the command'),
        );
        this.logger.log(
          `Canal de comandos do Gateway encerrado (${this.commandChannels.size} ativo(s))`,
        );
      };
    });
  }

  /**
   * Manda ao Gateway o comando de revogar sessões (Smart Kick, ban de rede) e devolve o que ele de fato derrubou.
   *
   * O comando não é enfileirado: sem Gateway conectado, ou sem resposta no prazo, a chamada falha em vez de
   * reportar um sucesso que não aconteceu. Um kick atrasado derrubaria uma sessão legítima aberta depois.
   */
  async revokePlayerSession(req: RevokeSessionRequest): Promise<RevokeSessionResponse> {
    if (this.commandChannels.size === 0) {
      throw new ServiceUnavailableException(
        'Gateway is not connected: the session revocation was not delivered',
      );
    }

    const outcomes = await Promise.allSettled(
      [...this.commandChannels].map((channel) => this.sendRevoke(channel, req)),
    );
    const answers = outcomes.flatMap((o) => (o.status === 'fulfilled' ? [o.value] : []));
    if (answers.length === 0) {
      throw (outcomes[0] as PromiseRejectedResult).reason;
    }

    const terminated = answers.reduce(
      (sum, answer) => sum + answer.terminated_connections_count,
      0,
    );
    this.logger.log(
      `Revogação de sessão para ${req.client_ip || req.minecraft_nick} (servidor: ${req.server_id || 'todos'}): ${terminated} sessão(ões) derrubada(s)`,
    );
    return { session_found: terminated > 0, terminated_connections_count: terminated };
  }

  private async sendRevoke(
    channel: CommandChannel,
    req: RevokeSessionRequest,
  ): Promise<RevokeSessionResponse> {
    const commandId = randomUUID();
    const result = await new Promise<GatewayCommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(
          new ServiceUnavailableException('Gateway did not answer the session revocation in time'),
        );
      }, COMMAND_TIMEOUT_MS);
      this.pendingCommands.set(commandId, { channel, resolve, reject, timer });
      channel.send({ command_id: commandId, revoke_session: req });
    });

    if (result.error) {
      throw new BadGatewayException(`Gateway could not revoke the session: ${result.error}`);
    }
    if (!result.revoke_session) {
      throw new BadGatewayException('Gateway answered the session revocation without a result');
    }
    const terminated = result.revoke_session.terminated_connections_count ?? 0;
    return { session_found: terminated > 0, terminated_connections_count: terminated };
  }

  private settleCommand(channel: CommandChannel, result: GatewayCommandResult): void {
    const pending = this.pendingCommands.get(result.command_id);
    if (!pending || pending.channel !== channel) {
      this.logger.warn(
        `Resultado de comando desconhecido ou expirado do Gateway: ${result.command_id}`,
      );
      return;
    }
    clearTimeout(pending.timer);
    this.pendingCommands.delete(result.command_id);
    pending.resolve(result);
  }

  private failPendingCommands(channel: CommandChannel, error: Error): void {
    for (const [commandId, pending] of this.pendingCommands) {
      if (pending.channel === channel) {
        clearTimeout(pending.timer);
        this.pendingCommands.delete(commandId);
        pending.reject(error);
      }
    }
  }
}
