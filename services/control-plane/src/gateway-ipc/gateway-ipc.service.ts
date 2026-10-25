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
import { IsNull, Repository } from 'typeorm';

import { Server } from '@database/entities/server.entity';
import { ServerGroup } from '@database/entities/server-group.entity';
import { TailscaleDevice } from '@database/entities/tailscale-device.entity';
import { User } from '@database/entities/user.entity';
import { UserGroup } from '@database/entities/user-group.entity';
import { UserServerAccess } from '@database/entities/user-server-access.entity';

import { AppConfigService } from '@config/app-config.service';
import { ManifestBuilder } from '@k8s/manifest-builder';
import {
  NETWORK_IDENTITY_PROVIDER,
  NetworkIdentity,
  NetworkIdentityProvider,
  PLAYER_TAG,
} from '../tailscale/identity/network-identity-provider.interface';
import { KubernetesService } from '@k8s/k8s.service';
import { effectiveAccessPolicy } from '../tailscale/decision/effective-access-policy';
import { UnlinkedAttemptsService } from '../tailscale/shares/unlinked-attempts.service';
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

export type IdentityMatchedBy =
  | 'TAILSCALE_USER_ID'
  | 'NODE_ID'
  | 'SHARED_EMAIL'
  | 'SHARED_GITHUB'
  | 'PENDING_INVITE'
  | 'NONE';

export interface IdentityProbeLookupResult {
  user: User | null;
  matchedBy: IdentityMatchedBy;
  wouldBind: boolean;
  networkIdentity: NetworkIdentity | null;
  pendingDevice: TailscaleDevice | null;
  warning?: string | null;
}

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
    @Optional()
    @InjectRepository(TailscaleDevice)
    private readonly deviceRepository?: Repository<TailscaleDevice>,
    @Optional()
    private readonly unlinkedAttempts?: UnlinkedAttemptsService,
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
   * Resolução pura de identidade (sem efeitos colaterais).
   * Não salva tailscale_user_id, não vincula dispositivos e não registra tentativas não vinculadas.
   */
  async probePlayerIdentity(input: {
    tailscaleUserId?: string;
    nodeId?: string;
    clientIp?: string;
  }): Promise<IdentityProbeLookupResult> {
    let user: User | null = null;
    let netId: NetworkIdentity | null = null;
    let warning: string | null = null;

    // 1. Busca por tailscaleUserId direto
    if (input.tailscaleUserId) {
      user = await this.userRepository.findOne({
        where: { tailscale_user_id: input.tailscaleUserId },
      });
      if (user) {
        return {
          user,
          matchedBy: 'TAILSCALE_USER_ID',
          wouldBind: false,
          networkIdentity: null,
          pendingDevice: null,
        };
      }
    }

    // 2. Busca por nodeId direto
    if (input.nodeId) {
      user = await this.findUserByNodeId(input.nodeId);
      if (user) {
        return {
          user,
          matchedBy: 'NODE_ID',
          wouldBind: false,
          networkIdentity: null,
          pendingDevice: null,
        };
      }
    }

    // 3. Busca por IP com WhoIs
    if (input.clientIp && this.identityProvider) {
      try {
        netId = await this.identityProvider.resolveIdentity(input.clientIp);
        if (netId) {
          if (netId.userId) {
            user = await this.userRepository.findOne({
              where: { tailscale_user_id: netId.userId },
            });
            if (user) {
              return {
                user,
                matchedBy: 'TAILSCALE_USER_ID',
                wouldBind: false,
                networkIdentity: netId,
                pendingDevice: null,
              };
            }
          }

          if (netId.nodeId) {
            user = await this.findUserByNodeId(netId.nodeId);
            if (user) {
              return {
                user,
                matchedBy: 'NODE_ID',
                wouldBind: false,
                networkIdentity: netId,
                pendingDevice: null,
              };
            }
          }

          // Verificação de nó compartilhado (dry-run de bindSharedUser)
          /**
           * Quem recebeu o nó compartilhado entra com a própria conta Tailscale, então o e-mail do login (que o
           * Tailscale já verificou) liga a conta ao cadastro feito pelo admin. O ID da conta fica gravado no
           * primeiro acesso e as buscas seguintes usam só ele.
           */
          const login = netId.loginName?.trim().toLowerCase();
          if (
            this.configService?.tailscale?.nodeSharingEnabled !== false &&
            login &&
            netId.userId &&
            !netId.tags?.length
          ) {
            const ghUser = login.endsWith('@github') ? login.slice(0, -7) : null;
            let candidate: User | null = null;
            let matchedBy: IdentityMatchedBy = 'NONE';

            if (ghUser) {
              candidate = await this.userRepository.findOne({
                where: [{ github_username: ghUser }, { email: login }],
              });
              matchedBy = candidate?.github_username === ghUser ? 'SHARED_GITHUB' : 'SHARED_EMAIL';
            } else if (login.includes('@')) {
              candidate = await this.userRepository.findOne({ where: { email: login } });
              matchedBy = 'SHARED_EMAIL';
            }

            if (candidate) {
              if (!candidate.tailscale_user_id || candidate.tailscale_user_id === netId.userId) {
                return {
                  user: candidate,
                  matchedBy,
                  wouldBind: !candidate.tailscale_user_id,
                  networkIdentity: netId,
                  pendingDevice: null,
                };
              }
              warning = `Cadastro de ${login} já pertence a outra conta Tailscale; acesso não vinculado`;
            }
          }

          // Verificação de convite pendente (dry-run de bindPendingDevice)
          /**
           * O convite entrega uma chave com a tag estática dos jogadores e nada diz qual nó a usou. Então o
           * primeiro nó com essa tag que o Gateway apresenta fica com o convite pendente, desde que haja
           * exatamente um: com vários, qualquer palpite daria a um jogador as permissões de outro.
           */
          if (this.deviceRepository && netId.nodeId && netId.tags?.includes(PLAYER_TAG)) {
            const pending = await this.deviceRepository.find({
              where: { status: 'PENDING', node_id: IsNull() },
              relations: { user: true },
              take: 2,
            });
            if (pending.length === 1 && pending[0].user) {
              return {
                user: pending[0].user,
                matchedBy: 'PENDING_INVITE',
                wouldBind: true,
                networkIdentity: netId,
                pendingDevice: pending[0],
              };
            }
            if (pending.length !== 1) {
              warning = `Nó ${netId.nodeId} com a tag ${PLAYER_TAG} não foi vinculado: ${pending.length} convites pendentes`;
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(
          `Falha na resolução de identidade de rede para IP ${input.clientIp}: ${err.message}`,
        );
      }
    }

    return {
      user: null,
      matchedBy: 'NONE',
      wouldBind: false,
      networkIdentity: netId ?? null,
      pendingDevice: null,
      warning,
    };
  }

  /**
   * Resolução pontual sob demanda de identidade do jogador (WhoIs -> User, Grupos, Nick).
   */
  async resolvePlayerIdentity(req: ResolvePlayerRequest): Promise<ResolvePlayerResponse> {
    this.logger.debug(
      `Resolvendo identidade gRPC: tailscale_user_id=${req.tailscale_user_id}, node_id=${req.node_id}, ip=${req.client_ip}`,
    );

    const lookup = await this.probePlayerIdentity({
      tailscaleUserId: req.tailscale_user_id || undefined,
      nodeId: req.node_id || undefined,
      clientIp: req.client_ip || undefined,
    });

    let user = lookup.user;

    if (user && lookup.wouldBind) {
      if (lookup.matchedBy === 'SHARED_EMAIL' || lookup.matchedBy === 'SHARED_GITHUB') {
        const netId = lookup.networkIdentity;
        if (netId?.userId) {
          user.tailscale_user_id = netId.userId;
          const login = netId.loginName?.trim().toLowerCase();
          const ghUser = login?.endsWith('@github') ? login.slice(0, -7) : null;
          if (ghUser && !user.github_username) {
            user.github_username = ghUser;
          }
          user = await this.userRepository.save(user);
        }
      } else if (lookup.matchedBy === 'PENDING_INVITE' && lookup.pendingDevice) {
        const device = lookup.pendingDevice;
        const netId = lookup.networkIdentity;
        device.node_id = netId?.nodeId || req.node_id || null;
        device.node_ip = netId?.nodeIp || req.client_ip || null;
        device.device_name = netId?.nodeName || null;
        device.status = 'ACTIVE';
        device.last_seen_at = new Date();
        await this.deviceRepository!.save(device);
        this.logger.log(
          `Nó ${device.node_id} vinculado ao convite resgatado por ${device.user.minecraft_nick}`,
        );
        user = device.user;
      }
    }

    if (!user) {
      if (lookup.warning) {
        this.logger.warn(lookup.warning);
      }

      this.unlinkedAttempts?.record({
        tailscaleUserId: lookup.networkIdentity?.userId || req.tailscale_user_id || '',
        loginName: lookup.networkIdentity?.loginName || '',
        displayName: lookup.networkIdentity?.displayName || '',
        clientIp: req.client_ip || '',
        nodeId: lookup.networkIdentity?.nodeId || req.node_id || '',
        nodeName: lookup.networkIdentity?.nodeName || '',
        minecraftNick: req.minecraft_nick || '',
      });

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
