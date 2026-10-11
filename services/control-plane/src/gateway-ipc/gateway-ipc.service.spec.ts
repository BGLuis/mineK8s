import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { Subject, firstValueFrom, take } from 'rxjs';

import {
  GatewayCommand,
  GatewayCommandResult,
  RouteAction,
  RouteUpdateEvent,
  SessionEventType,
  SessionLifecycleEvent,
} from './gateway-ipc.interfaces';
import { GatewayIpcService } from './gateway-ipc.service';
import { PlayerSessionsService } from './player-sessions.service';

describe('GatewayIpcService (RF-GW-16, RF-MG-04)', () => {
  let service: GatewayIpcService;
  let mockServerRepo: any;
  let mockUserRepo: any;
  let mockServerGroupRepo: any;
  let mockUserServerAccessRepo: any;
  let mockUserGroupRepo: any;
  let mockK8sService: any;
  let playerSessions: PlayerSessionsService;
  let icons: { dataUri: jest.Mock };

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
          name: 'Survival',
          minecraft_settings: {
            server_port: 25565,
            proxy_protocol: true,
            max_players: 12,
            language: 'en',
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
        if (where.devices?.node_id === 'node-999') {
          return {
            id: 'user-uuid-2',
            minecraft_nick: 'NodePlayer',
            role: 'ADMIN',
            tailscale_user_id: null,
            is_mojang_verified: false,
          };
        }
        return null;
      }),
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

    playerSessions = new PlayerSessionsService();
    icons = { dataUri: jest.fn(async () => null) };

    service = new GatewayIpcService(
      mockServerRepo,
      mockUserRepo,
      mockServerGroupRepo,
      mockUserServerAccessRepo,
      mockUserGroupRepo,
      undefined,
      mockK8sService,
      playerSessions,
      { kubernetes: { namespace: 'minekubernetes' } } as any,
      icons as any,
    );
  });

  describe('Ícone da lista de servidores', () => {
    it('leva nome, limite de jogadores e idioma, para o Gateway não mostrar o UUID nem um limite inventado', async () => {
      const snapshot = await service.getInitialRoutingSnapshot();

      expect(snapshot.routes[0]).toMatchObject({
        name: 'Survival',
        max_players: 12,
        language: 'en',
      });
    });

    it('um mundo sem configurações vai com limite 0 e o idioma padrão', async () => {
      const snapshot = await service.getInitialRoutingSnapshot();

      expect(snapshot.routes[1]).toMatchObject({ max_players: 0, language: 'pt-BR' });
    });

    it('leva o ícone do servidor na rota, para o Gateway responder o status enquanto a JVM dorme', async () => {
      icons.dataUri.mockImplementation(async (server: any) =>
        server.id === 'server-uuid-1' ? 'data:image/png;base64,AAAA' : null,
      );

      const snapshot = await service.getInitialRoutingSnapshot();

      expect(snapshot.routes[0].favicon).toBe('data:image/png;base64,AAAA');
      expect(snapshot.routes[1].favicon).toBe('');
    });
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

    it('leva o ícone novo na rota republicada', async () => {
      icons.dataUri.mockResolvedValue('data:image/png;base64,BBBB');
      mockServerRepo.findOne = jest.fn(async () => baseServer);
      const emitted = firstValueFrom(service.getRouteUpdatesStream().pipe(take(1)));

      await service.publishRoute('server-uuid-1');

      expect((await emitted).favicon).toBe('data:image/png;base64,BBBB');
    });

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

  describe('Sessões de jogadores a partir dos eventos do Gateway', () => {
    const sessionEvent = (type: SessionEventType, sessionId: string, nick: string) => ({
      event_type: type,
      session_id: sessionId,
      server_id: 'server-uuid-1',
      client_ip: '100.64.0.2',
      minecraft_nick: nick,
      timestamp_epoch_ms: Date.now(),
      reason: '',
    });

    it('CONNECTED aumenta a contagem e DISCONNECTED diminui', async () => {
      await service.handleSessionEvent(sessionEvent(SessionEventType.CONNECTED, 's1', 'Steve'));
      await service.handleSessionEvent(sessionEvent(SessionEventType.CONNECTED, 's2', 'Alex'));
      expect(playerSessions.count('server-uuid-1')).toBe(2);

      await service.handleSessionEvent(sessionEvent(SessionEventType.DISCONNECTED, 's1', 'Steve'));

      expect(playerSessions.count('server-uuid-1')).toBe(1);
    });

    it('conta como sessão o CONNECTED que chega sem event_type, porque o prost não serializa o zero', async () => {
      const { event_type: _omitted, ...onTheWire } = sessionEvent(
        SessionEventType.CONNECTED,
        's1',
        'Steve',
      );

      await service.handleSessionEvent(onTheWire as unknown as SessionLifecycleEvent);

      expect(playerSessions.count('server-uuid-1')).toBe(1);
    });

    it('ACCESS_DENIED não vira sessão ativa', async () => {
      await service.handleSessionEvent(
        sessionEvent(SessionEventType.ACCESS_DENIED, 's1', 'Intruso'),
      );

      expect(playerSessions.count('server-uuid-1')).toBe(0);
    });

    it('descarta as sessões quando o stream do Gateway fecha, para o Gateway reenviá-las ao reconectar', async () => {
      await service.handleSessionEvent(sessionEvent(SessionEventType.CONNECTED, 's1', 'Steve'));

      service.handleSessionStreamClosed();

      expect(playerSessions.count('server-uuid-1')).toBe(0);
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

  describe('Vínculo do nó ao convite resgatado', () => {
    const newcomer = { id: 'user-new', minecraft_nick: 'Novato', role: 'PLAYER' };
    const request = {
      tailscale_user_id: 'tagged-devices',
      node_id: 'node-new',
      client_ip: '100.99.1.1',
    };
    let deviceRepo: { find: jest.Mock; save: jest.Mock };
    let identityProvider: { resolveIdentity: jest.Mock };
    let pending: any[];

    beforeEach(() => {
      pending = [{ id: 'dev-1', user: newcomer, status: 'PENDING', node_id: null, node_ip: null }];
      deviceRepo = {
        find: jest.fn(async () => pending),
        save: jest.fn(async (d: any) => d),
      };
      identityProvider = {
        resolveIdentity: jest.fn(async () => ({
          userId: 'tagged-devices',
          loginName: 'tagged-devices',
          displayName: 'tagged-devices',
          nodeId: 'node-new',
          nodeName: 'novato',
          nodeIp: '100.99.1.1',
          tags: ['tag:mc-player'],
          isOwner: false,
        })),
      };
      mockUserRepo.findOne = jest.fn(async () => null);
      service = new GatewayIpcService(
        mockServerRepo,
        mockUserRepo,
        mockServerGroupRepo,
        mockUserServerAccessRepo,
        mockUserGroupRepo,
        identityProvider as any,
        undefined,
        undefined,
        undefined,
        undefined,
        deviceRepo as any,
      );
    });

    it('o primeiro contato de um nó com a tag de jogador o vincula ao único convite pendente', async () => {
      const resp = await service.resolvePlayerIdentity(request);

      expect(resp).toMatchObject({ found: true, user_id: 'user-new', minecraft_nick: 'Novato' });
      expect(deviceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'dev-1',
          node_id: 'node-new',
          node_ip: '100.99.1.1',
          status: 'ACTIVE',
        }),
      );
    });

    it('um nó sem a tag de jogador não herda convite nenhum', async () => {
      identityProvider.resolveIdentity.mockResolvedValue({
        userId: 'someone',
        nodeId: 'node-new',
        nodeIp: '100.99.1.1',
        tags: [],
      });

      const resp = await service.resolvePlayerIdentity(request);

      expect(resp.found).toBe(false);
      expect(deviceRepo.save).not.toHaveBeenCalled();
    });

    it('com mais de um convite pendente não adivinha de quem é o nó', async () => {
      pending.push({ id: 'dev-2', user: { id: 'user-other' }, status: 'PENDING', node_id: null });

      const resp = await service.resolvePlayerIdentity(request);

      expect(resp.found).toBe(false);
      expect(deviceRepo.save).not.toHaveBeenCalled();
    });

    it('sem convite pendente o nó segue não registrado', async () => {
      pending.length = 0;

      const resp = await service.resolvePlayerIdentity(request);

      expect(resp.found).toBe(false);
      expect(deviceRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('Quem recebeu o nó compartilhado', () => {
    const sharee = {
      id: 'user-shared',
      email: 'amigo@example.com',
      minecraft_nick: 'Amigo',
      role: 'PLAYER',
      tailscale_user_id: null as string | null,
    };
    const request = { tailscale_user_id: 'ts-777', node_id: 'node-777', client_ip: '100.88.1.1' };
    let identityProvider: { resolveIdentity: jest.Mock };
    let saveUser: jest.Mock;

    beforeEach(() => {
      sharee.tailscale_user_id = null;
      saveUser = jest.fn(async (u) => u);
      identityProvider = {
        resolveIdentity: jest.fn(async () => ({
          userId: 'ts-777',
          loginName: 'Amigo@Example.com',
          displayName: 'Amigo',
          nodeId: 'node-777',
          nodeName: 'pc-do-amigo',
          nodeIp: '100.88.1.1',
          tags: [],
          isOwner: true,
        })),
      };
      mockUserRepo.findOne = jest.fn(async ({ where }: any) =>
        where.email === 'amigo@example.com' ? sharee : null,
      );
      mockUserRepo.save = saveUser;
      service = new GatewayIpcService(
        mockServerRepo,
        mockUserRepo,
        mockServerGroupRepo,
        mockUserServerAccessRepo,
        mockUserGroupRepo,
        identityProvider as any,
      );
    });

    it('o primeiro acesso casa o e-mail do login Tailscale com o cadastro e grava o ID da conta', async () => {
      const resp = await service.resolvePlayerIdentity(request);

      expect(resp).toMatchObject({ found: true, user_id: 'user-shared', minecraft_nick: 'Amigo' });
      expect(saveUser).toHaveBeenCalledWith(
        expect.objectContaining({ tailscale_user_id: 'ts-777' }),
      );
    });

    it('com o compartilhamento de nó desativado, o e-mail não liga conta nenhuma', async () => {
      service = new GatewayIpcService(
        mockServerRepo,
        mockUserRepo,
        mockServerGroupRepo,
        mockUserServerAccessRepo,
        mockUserGroupRepo,
        identityProvider as any,
        undefined,
        undefined,
        { tailscale: { nodeSharingEnabled: false } } as any,
      );

      const resp = await service.resolvePlayerIdentity(request);

      expect(resp.found).toBe(false);
      expect(saveUser).not.toHaveBeenCalled();
    });

    it('um e-mail sem cadastro segue não registrado', async () => {
      identityProvider.resolveIdentity.mockResolvedValue({
        userId: 'ts-888',
        loginName: 'desconhecido@example.com',
        nodeId: 'node-888',
        tags: [],
      });

      const resp = await service.resolvePlayerIdentity(request);

      expect(resp.found).toBe(false);
      expect(saveUser).not.toHaveBeenCalled();
    });

    it('não troca a conta de um cadastro que já pertence a outra conta Tailscale', async () => {
      sharee.tailscale_user_id = 'ts-outra-conta';

      const resp = await service.resolvePlayerIdentity(request);

      expect(resp.found).toBe(false);
      expect(saveUser).not.toHaveBeenCalled();
    });

    it('um nó com tag não tem dono: o e-mail dele não vale como identidade', async () => {
      identityProvider.resolveIdentity.mockResolvedValue({
        userId: 'tagged-devices',
        loginName: 'amigo@example.com',
        nodeId: 'node-777',
        tags: ['tag:outra'],
      });

      const resp = await service.resolvePlayerIdentity(request);

      expect(resp.found).toBe(false);
      expect(saveUser).not.toHaveBeenCalled();
    });
  });

  describe('Comandos de revogação enviados ao Gateway (Smart Kick, ban de rede)', () => {
    const request = {
      server_id: 'server-uuid-1',
      client_ip: '',
      minecraft_nick: 'LucasCraft',
      reason_message: 'Banido da sessão',
    };

    /** Gateway simulado: guarda os comandos recebidos e responde pelo stream de resultados. */
    function connectGateway() {
      const results$ = new Subject<GatewayCommandResult>();
      const received: GatewayCommand[] = [];
      const subscription = service
        .openCommandStream(results$)
        .subscribe((command) => received.push(command));
      return { results$, received, disconnect: () => subscription.unsubscribe() };
    }

    afterEach(() => jest.useRealTimers());

    it('sem Gateway conectado falha explicitamente em vez de reportar sucesso', async () => {
      await expect(service.revokePlayerSession(request)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('envia o comando ao Gateway e devolve a contagem real de sessões derrubadas', async () => {
      const gateway = connectGateway();

      const pending = service.revokePlayerSession(request);
      expect(gateway.received).toHaveLength(1);
      expect(gateway.received[0].revoke_session).toEqual(request);
      gateway.results$.next({
        command_id: gateway.received[0].command_id,
        revoke_session: { session_found: true, terminated_connections_count: 3 },
      });

      await expect(pending).resolves.toEqual({
        session_found: true,
        terminated_connections_count: 3,
      });
    });

    it('nenhuma sessão derrubada vira 0 e session_found falso, mesmo com o proto omitindo campos zerados', async () => {
      const gateway = connectGateway();

      const pending = service.revokePlayerSession(request);
      gateway.results$.next({ command_id: gateway.received[0].command_id, revoke_session: {} });

      await expect(pending).resolves.toEqual({
        session_found: false,
        terminated_connections_count: 0,
      });
    });

    it('correlaciona cada resposta ao seu comando, mesmo fora de ordem', async () => {
      const gateway = connectGateway();

      const first = service.revokePlayerSession({ ...request, minecraft_nick: 'First' });
      const second = service.revokePlayerSession({ ...request, minecraft_nick: 'Second' });
      gateway.results$.next({
        command_id: gateway.received[1].command_id,
        revoke_session: { terminated_connections_count: 2 },
      });
      gateway.results$.next({
        command_id: gateway.received[0].command_id,
        revoke_session: { terminated_connections_count: 1 },
      });

      await expect(first).resolves.toMatchObject({ terminated_connections_count: 1 });
      await expect(second).resolves.toMatchObject({ terminated_connections_count: 2 });
    });

    it('repassa o erro com que o Gateway recusou o comando', async () => {
      const gateway = connectGateway();

      const pending = service.revokePlayerSession(request);
      gateway.results$.next({
        command_id: gateway.received[0].command_id,
        error: 'client_ip inválido: x',
      });

      await expect(pending).rejects.toThrow(BadGatewayException);
      await expect(pending).rejects.toThrow('client_ip inválido: x');
    });

    it('falha por timeout quando o Gateway não responde', async () => {
      jest.useFakeTimers();
      connectGateway();

      const pending = service.revokePlayerSession(request);
      const assertion = expect(pending).rejects.toThrow('did not answer');
      await jest.advanceTimersByTimeAsync(5001);

      await assertion;
    });

    it('falha o comando em andamento quando o Gateway desconecta, e a chamada seguinte já acusa o Gateway ausente', async () => {
      const gateway = connectGateway();

      const pending = service.revokePlayerSession(request);
      gateway.disconnect();

      await expect(pending).rejects.toThrow(ServiceUnavailableException);
      await expect(service.revokePlayerSession(request)).rejects.toThrow(
        'Gateway is not connected',
      );
    });

    it('ignora resultados sem comando pendente', async () => {
      const gateway = connectGateway();

      expect(() =>
        gateway.results$.next({ command_id: 'desconhecido', revoke_session: {} }),
      ).not.toThrow();
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
