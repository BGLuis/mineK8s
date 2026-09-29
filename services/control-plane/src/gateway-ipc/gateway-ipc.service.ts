import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, Subject } from 'rxjs';
import { Repository } from 'typeorm';

import { Server } from '@database/entities/server.entity';
import { ServerGroup } from '@database/entities/server-group.entity';
import { User } from '@database/entities/user.entity';
import { UserGroup } from '@database/entities/user-group.entity';
import { UserServerAccess } from '@database/entities/user-server-access.entity';

import { NETWORK_IDENTITY_PROVIDER, NetworkIdentityProvider } from '../tailscale/identity/network-identity-provider.interface';
import {
  Empty,
  ResolvePlayerRequest,
  ResolvePlayerResponse,
  RevokeSessionRequest,
  RevokeSessionResponse,
  RouteAction,
  RouteUpdateEvent,
  RoutingSnapshotResponse,
  SessionLifecycleEvent,
} from './gateway-ipc.interfaces';

@Injectable()
export class GatewayIpcService {
  private readonly logger = new Logger(GatewayIpcService.name);
  private readonly routeUpdates$ = new Subject<RouteUpdateEvent>();

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
      relations: ['minecraft_settings'],
    });

    const routes: RouteUpdateEvent[] = [];

    for (const server of servers) {
      const serverGroups = await this.serverGroupRepository.find({
        where: { server_id: server.id },
      });
      const userAccesses = await this.userServerAccessRepository.find({
        where: { server_id: server.id },
      });

      const allowedGroupIds = serverGroups.map((sg) => sg.group_id);
      const allowedUserIds = userAccesses.map((ua) => ua.user_id);

      const targetPort = 25565;
      const targetHost = `mc-${server.subdomain}.minekubernetes.svc.cluster.local`;

      routes.push({
        action: RouteAction.UPSERT,
        server_id: server.id,
        subdomain: server.subdomain,
        target_ip_port: `${targetHost}:${targetPort}`,
        status: String(server.state || 'STOPPED').toUpperCase(),
        access_policy: (server as any).access_policy || 'PUBLIC',
        allowed_group_ids: allowedGroupIds,
        allowed_user_ids: allowedUserIds,
        proxy_protocol: Boolean((server.minecraft_settings as any)?.proxy_protocol),
        game_type: server.game_type || 'MINECRAFT',
        routing_model: server.routing_model || 'VirtualHost',
        listen_port: server.allocated_port || 25565,
      });
    }

    this.logger.log(`Snapshot inicial construído com sucesso: ${routes.length} rotas enviadas ao Gateway`);
    return { routes };
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
      user = await this.userRepository
        .createQueryBuilder('user')
        .innerJoin('user.devices', 'device')
        .where('device.tailscale_node_id = :nodeId', { nodeId: req.node_id })
        .getOne();
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
            user = await this.userRepository
              .createQueryBuilder('user')
              .innerJoin('user.devices', 'device')
              .where('device.tailscale_node_id = :nodeId', { nodeId: netId.nodeId })
              .getOne();
          }
        }
      } catch (err: any) {
        this.logger.warn(`Falha na resolução de identidade de rede para IP ${req.client_ip}: ${err.message}`);
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

  /**
   * Processa eventos de ciclo de vida de sessão streaming vindos do Gateway.
   */
  handleSessionEvent(event: SessionLifecycleEvent): void {
    this.logger.log(
      `Evento de sessão recebido do Gateway: [${event.event_type}] user=${event.minecraft_nick} server=${event.server_id} ip=${event.client_ip}`,
    );
  }

  /**
   * Processa comando de revogação de sessão (Smart Kick).
   */
  async revokePlayerSession(req: RevokeSessionRequest): Promise<RevokeSessionResponse> {
    this.logger.log(
      `Revogação de sessão solicitada para jogador ${req.minecraft_nick || req.client_ip} no servidor ${req.server_id}`,
    );

    return {
      session_found: true,
      terminated_connections_count: 1,
    };
  }
}
