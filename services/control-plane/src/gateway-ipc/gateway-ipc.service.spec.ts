import { firstValueFrom, take } from 'rxjs';

import { RouteAction, RouteUpdateEvent, SessionEventType } from './gateway-ipc.interfaces';
import { GatewayIpcService } from './gateway-ipc.service';

describe('GatewayIpcService (RF-GW-16, RF-MG-04)', () => {
  let service: GatewayIpcService;
  let mockServerRepo: any;
  let mockUserRepo: any;
  let mockServerGroupRepo: any;
  let mockUserServerAccessRepo: any;
  let mockUserGroupRepo: any;
  let mockK8sService: any;

  beforeEach(() => {
    mockServerRepo = {
      find: jest.fn(async () => [
        {
          id: 'server-uuid-1',
          subdomain: 'survival',
          state: 'READY',
          access_policy: 'GROUP',
          game_type: 'MINECRAFT',
          routing_model: 'VirtualHost',
          allocated_port: 25565,
          minecraft_settings: {
            server_port: 25565,
            proxy_protocol: true,
          },
        },
        {
          id: 'server-uuid-2',
          subdomain: 'terraria',
          state: 'STOPPED',
          access_policy: 'PUBLIC',
          game_type: 'TERRARIA',
          routing_model: 'DedicatedPort',
          allocated_port: 7777,
          minecraft_settings: null,
        },
      ]),
    };

    mockUserRepo = {
      findOne: jest.fn(async ({ where }: any) => {
        if (where.tailscale_user_id === 'ts-user-123') {
          return {
            id: 'user-uuid-1',
            minecraft_nick: 'LucasCraft',
            role: 'PLAYER',
            tailscale_user_id: 'ts-user-123',
            is_mojang_verified: true,
          };
        }
        return null;
      }),
      createQueryBuilder: jest.fn(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => ({
          id: 'user-uuid-2',
          minecraft_nick: 'NodePlayer',
          role: 'ADMIN',
          tailscale_user_id: null,
          is_mojang_verified: false,
        })),
      })),
    };

    mockServerGroupRepo = {
      find: jest.fn(async ({ where }: any) => {
        if (where.server_id === 'server-uuid-1') {
          return [{ group_id: 'group-vip' }];
        }
        return [];
      }),
    };

    mockUserServerAccessRepo = {
      find: jest.fn(async () => [{ user_id: 'user-uuid-1' }]),
    };

    mockUserGroupRepo = {
      find: jest.fn(async () => [{ group_id: 'group-vip' }]),
    };

    mockK8sService = {
      startServer: jest.fn().mockResolvedValue(undefined),
      stopServer: jest.fn().mockResolvedValue(undefined),
    };

    service = new GatewayIpcService(
      mockServerRepo,
      mockUserRepo,
      mockServerGroupRepo,
      mockUserServerAccessRepo,
      mockUserGroupRepo,
      undefined,
      mockK8sService,
    );
  });

  describe('GetInitialRoutingSnapshot (RF-GW-16, RF-MG-04)', () => {
    it('deve construir o snapshot completo com rotas multi-jogo e políticas de acesso', async () => {
      const snapshot = await service.getInitialRoutingSnapshot();

      expect(snapshot.routes).toHaveLength(2);

      const r1 = snapshot.routes[0];
      expect(r1.server_id).toBe('server-uuid-1');
      expect(r1.subdomain).toBe('survival');
      expect(r1.status).toBe('READY');
      expect(r1.access_policy).toBe('GROUP');
      expect(r1.allowed_group_ids).toEqual(['group-vip']);
      expect(r1.allowed_user_ids).toEqual(['user-uuid-1']);
      expect(r1.proxy_protocol).toBe(true);
      expect(r1.game_type).toBe('MINECRAFT');
      expect(r1.routing_model).toBe('VirtualHost');
      expect(r1.listen_port).toBe(25565);

      const r2 = snapshot.routes[1];
      expect(r2.server_id).toBe('server-uuid-2');
      expect(r2.game_type).toBe('TERRARIA');
      expect(r2.routing_model).toBe('DedicatedPort');
      expect(r2.listen_port).toBe(7777);
      expect(r2.status).toBe('STOPPED');
    });
  });

  describe('publishRoute: mudanças de configuração chegam ao Gateway como UPSERT', () => {
    const baseServer = {
      id: 'server-uuid-1',
      subdomain: 'survival',
      state: 'READY',
      access_policy: 'GROUP',
      is_maintenance: false,
      auto_wake: true,
      game_type: 'MINECRAFT',
      routing_model: 'VirtualHost',
      allocated_port: 25565,
      minecraft_settings: null,
    };

    it('envia a política configurada com os grupos e usuários permitidos', async () => {
      mockServerRepo.findOne = jest.fn(async () => baseServer);
      const emitted = firstValueFrom(service.getRouteUpdatesStream().pipe(take(1)));

      await service.publishRoute('server-uuid-1');

      const event = await emitted;
      expect(event.action).toBe(RouteAction.UPSERT);
      expect(event.access_policy).toBe('GROUP');
      expect(event.allowed_group_ids).toEqual(['group-vip']);
    });

    it('is_maintenance vira a política MAINTENANCE, que o Gateway já nega a não-admins', async () => {
      mockServerRepo.findOne = jest.fn(async () => ({ ...baseServer, is_maintenance: true }));
      const emitted = firstValueFrom(service.getRouteUpdatesStream().pipe(take(1)));

      await service.publishRoute('server-uuid-1');

      expect((await emitted).access_policy).toBe('MAINTENANCE');
    });

    it('ignora servidor inexistente sem emitir evento', async () => {
      mockServerRepo.findOne = jest.fn(async () => null);
      const spy = jest.spyOn(service, 'broadcastRouteUpdate');

      await service.publishRoute('nope');

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('StreamRouteUpdates (RF-GW-16)', () => {
    it('deve transmitir RouteUpdateEvent via Subject reativo para o Gateway', async () => {
      const stream = service.getRouteUpdatesStream();

      const eventPromise = firstValueFrom(stream.pipe(take(1)));

      const updateEvent: RouteUpdateEvent = {
        action: RouteAction.UPSERT,
        server_id: 'server-uuid-3',
        subdomain: 'hardcore',
        target_ip_port: 'mc-hardcore.minekubernetes.svc.cluster.local:25565',
        status: 'READY',
        access_policy: 'PUBLIC',
        allowed_group_ids: [],
        allowed_user_ids: [],
        proxy_protocol: false,
        game_type: 'MINECRAFT',
        routing_model: 'VirtualHost',
        listen_port: 25565,
        auto_wake: false,
      };

      service.broadcastRouteUpdate(updateEvent);

      const received = await eventPromise;
      expect(received).toEqual(updateEvent);
    });
  });

  describe('ResolvePlayerIdentity (Homologado em F5)', () => {
    it('deve resolver identidade do usuário por tailscale_user_id', async () => {
      const resp = await service.resolvePlayerIdentity({
        tailscale_user_id: 'ts-user-123',
        node_id: '',
        client_ip: '100.64.0.15',
      });

      expect(resp.found).toBe(true);
      expect(resp.user_id).toBe('user-uuid-1');
      expect(resp.minecraft_nick).toBe('LucasCraft');
      expect(resp.role).toBe('PLAYER');
      expect(resp.group_ids).toEqual(['group-vip']);
      expect(resp.is_mojang_verified).toBe(true);
    });

    it('deve resolver identidade por node_id se tailscale_user_id não bater', async () => {
      const resp = await service.resolvePlayerIdentity({
        tailscale_user_id: 'unknown-id',
        node_id: 'node-999',
        client_ip: '100.64.0.20',
      });

      expect(resp.found).toBe(true);
      expect(resp.minecraft_nick).toBe('NodePlayer');
      expect(resp.role).toBe('ADMIN');
    });

    it('deve retornar found: false para nós desconhecidos', async () => {
      mockUserRepo.findOne = jest.fn(async () => null);
      mockUserRepo.createQueryBuilder = jest.fn(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => null),
      }));

      const resp = await service.resolvePlayerIdentity({
        tailscale_user_id: 'non-existent',
        node_id: 'non-existent-node',
        client_ip: '100.64.0.99',
      });

      expect(resp.found).toBe(false);
      expect(resp.user_id).toBe('');
      expect(resp.minecraft_nick).toBe('');
    });
  });

  describe('RevokePlayerSession (Smart Kick)', () => {
    it('deve responder à requisição de revogação de sessão', async () => {
      const resp = await service.revokePlayerSession({
        server_id: 'server-uuid-1',
        client_ip: '100.64.0.15',
        minecraft_nick: 'LucasCraft',
        reason_message: 'Banido da sessão',
      });

      expect(resp.session_found).toBe(true);
      expect(resp.terminated_connections_count).toBe(1);
    });
  });

  describe('Auto-Wake on demand (RF-GW-10, RF-ARQ-27)', () => {
    it('deve disparar scale-up do pod, mudar estado para STARTING e notificar Gateway ao receber WAKE_REQUESTED', async () => {
      const stoppedServer = {
        id: 'server-stopped-1',
        subdomain: 'vanilla',
        state: 'STOPPED',
        auto_wake: true,
        allocated_port: 25565,
        game_type: 'MINECRAFT',
        routing_model: 'VirtualHost',
        minecraft_settings: { proxy_protocol: false },
      };

      mockServerRepo.findOne = jest.fn(async () => stoppedServer);
      mockServerRepo.save = jest.fn(async (s) => s);

      const streamPromise = firstValueFrom(service.getRouteUpdatesStream().pipe(take(1)));

      await service.handleSessionEvent({
        event_type: SessionEventType.WAKE_REQUESTED,
        session_id: 'sess-123',
        server_id: 'server-stopped-1',
        client_ip: '100.64.0.10',
        minecraft_nick: 'Steve',
        timestamp_epoch_ms: Date.now(),
        reason: 'Hold Connection Trigger',
      });

      expect(stoppedServer.state).toBe('STARTING');
      expect(mockServerRepo.save).toHaveBeenCalledWith(stoppedServer);
      expect(mockK8sService.startServer).toHaveBeenCalledWith(stoppedServer);

      const event = await streamPromise;
      expect(event.server_id).toBe('server-stopped-1');
      expect(event.status).toBe('STARTING');
      expect(event.action).toBe(RouteAction.STATUS_CHANGE);
      expect(event.auto_wake).toBe(true);
    });

    it('não deve iniciar servidor nem notificar quando auto_wake for desabilitado', async () => {
      const disabledServer = {
        id: 'server-nowake',
        subdomain: 'nowake',
        state: 'STOPPED',
        auto_wake: false,
      };

      mockServerRepo.findOne = jest.fn(async () => disabledServer);
      mockServerRepo.save = jest.fn();

      await service.handleSessionEvent({
        event_type: SessionEventType.WAKE_REQUESTED,
        session_id: 'sess-456',
        server_id: 'server-nowake',
        client_ip: '100.64.0.10',
        minecraft_nick: 'Steve',
        timestamp_epoch_ms: Date.now(),
        reason: 'Hold Connection Trigger',
      });

      expect(disabledServer.state).toBe('STOPPED');
      expect(mockServerRepo.save).not.toHaveBeenCalled();
      expect(mockK8sService.startServer).not.toHaveBeenCalled();
    });
  });
});
