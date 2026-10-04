import { Subject, of } from 'rxjs';

import { RouteAction, RouteUpdateEvent } from './gateway-ipc.interfaces';
import { GatewayIpcController } from './gateway-ipc.controller';

describe('GatewayIpcController', () => {
  let controller: GatewayIpcController;
  let mockIpcService: any;

  beforeEach(() => {
    mockIpcService = {
      getInitialRoutingSnapshot: jest.fn(async () => ({
        routes: [
          {
            action: RouteAction.UPSERT,
            server_id: 'srv-1',
            subdomain: 'survival',
            status: 'READY',
          },
        ],
      })),
      getRouteUpdatesStream: jest.fn(() =>
        of<RouteUpdateEvent>({
          action: RouteAction.UPSERT,
          server_id: 'srv-1',
          subdomain: 'survival',
          target_ip_port: 'mc-survival:25565',
          status: 'READY',
          access_policy: 'PUBLIC',
          allowed_group_ids: [],
          allowed_user_ids: [],
          proxy_protocol: false,
          game_type: 'MINECRAFT',
          routing_model: 'VirtualHost',
          listen_port: 25565,
          auto_wake: false,
        }),
      ),
      handleSessionEvent: jest.fn(async () => undefined),
      handleSessionStreamClosed: jest.fn(),
      openCommandStream: jest.fn((results$) => results$),
      resolvePlayerIdentity: jest.fn(async () => ({
        found: true,
        user_id: 'u-1',
        minecraft_nick: 'Steve',
        role: 'PLAYER',
        group_ids: [],
        is_active: true,
        is_mojang_verified: false,
      })),
    };

    controller = new GatewayIpcController(mockIpcService);
  });

  it('deve delegar getInitialRoutingSnapshot para o serviço', async () => {
    const res = await controller.getInitialRoutingSnapshot({});
    expect(res.routes).toHaveLength(1);
    expect(mockIpcService.getInitialRoutingSnapshot).toHaveBeenCalled();
  });

  it('deve retornar stream de rotas', (done) => {
    controller.streamRouteUpdates({}).subscribe({
      next: (update) => {
        expect(update.server_id).toBe('srv-1');
        done();
      },
    });
  });

  it('deve processar stream de eventos de sessão', (done) => {
    const events$ = of({
      event_type: 0,
      session_id: 'sess-1',
      server_id: 'srv-1',
      client_ip: '100.64.0.5',
      minecraft_nick: 'Steve',
      timestamp_epoch_ms: Date.now(),
      reason: '',
    });

    controller.streamSessionEvents(events$).subscribe({
      complete: () => {
        expect(mockIpcService.handleSessionEvent).toHaveBeenCalled();
        done();
      },
    });
  });

  it('só responde ao RPC quando o Gateway encerra o fluxo, e processa todos os eventos até lá', () => {
    const incoming$ = new Subject<any>();
    const responses: unknown[] = [];
    let completed = false;
    controller.streamSessionEvents(incoming$).subscribe({
      next: (response) => responses.push(response),
      complete: () => (completed = true),
    });

    incoming$.next({ event_type: 0, server_id: 'srv-1', minecraft_nick: 'Steve' });
    incoming$.next({ event_type: 0, server_id: 'srv-1', minecraft_nick: 'Alex' });
    expect(responses).toEqual([]);
    expect(completed).toBe(false);
    expect(mockIpcService.handleSessionEvent).toHaveBeenCalledTimes(2);

    incoming$.complete();
    expect(responses).toEqual([{}]);
    expect(completed).toBe(true);
  });

  it('descarta as sessões conhecidas quando o stream de eventos do Gateway termina ou falha', () => {
    const closing$ = new Subject<any>();
    controller.streamSessionEvents(closing$).subscribe();

    closing$.complete();
    expect(mockIpcService.handleSessionStreamClosed).toHaveBeenCalledTimes(1);

    const failing$ = new Subject<any>();
    controller.streamSessionEvents(failing$).subscribe({ error: () => undefined });
    failing$.error(new Error('conexão perdida'));
    expect(mockIpcService.handleSessionStreamClosed).toHaveBeenCalledTimes(2);
  });

  it('entrega o stream de resultados do Gateway ao serviço e devolve o stream de comandos', () => {
    const results$ = new Subject<any>();

    const commands$ = controller.streamCommands(results$);

    expect(mockIpcService.openCommandStream).toHaveBeenCalledWith(results$);
    expect(commands$).toBe(results$);
  });

  it('deve delegar resolvePlayerIdentity', async () => {
    const res = await controller.resolvePlayerIdentity({
      tailscale_user_id: 'ts-1',
      node_id: '',
      client_ip: '100.64.0.5',
    });
    expect(res.found).toBe(true);
    expect(res.minecraft_nick).toBe('Steve');
  });
});
