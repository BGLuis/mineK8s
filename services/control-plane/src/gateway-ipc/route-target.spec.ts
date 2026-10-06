import { Server } from '@database/entities/server.entity';
import { ManifestBuilder } from '@k8s/manifest-builder';

import { ReconcilerService } from '../reconciler/reconciler.service';
import { ServersService } from '../servers/servers.service';
import { RouteAction, RouteUpdateEvent } from './gateway-ipc.interfaces';
import { GatewayIpcService } from './gateway-ipc.service';

/**
 * Snapshot, UPSERT, auto-wake, ServersService e reconciliador publicam a mesma rota; o Gateway fica com a última
 * que chegar, então todas precisam apontar para o Service que o control plane criou (#137).
 */
describe('target_ip_port igual em todas as origens de rota (#137)', () => {
  const config = { isTest: true, kubernetes: { namespace: 'games' } } as any;
  const server = {
    id: 'srv-1',
    subdomain: 'hub',
    state: 'STOPPED',
    allocated_port: 25570,
    auto_wake: true,
    minecraft_settings: null,
  } as unknown as Server;

  let events: RouteUpdateEvent[];
  let gatewayIpc: GatewayIpcService;

  beforeEach(() => {
    const serverRepo = {
      find: jest.fn(async () => [{ ...server }]),
      findOne: jest.fn(async () => ({ ...server })),
      save: jest.fn(async (s: Server) => s),
    };
    const emptyRepo = { find: jest.fn(async () => []) };
    gatewayIpc = new GatewayIpcService(
      serverRepo as any,
      emptyRepo as any,
      emptyRepo as any,
      emptyRepo as any,
      emptyRepo as any,
      undefined,
      { startServer: jest.fn() } as any,
      undefined,
      config,
    );
    events = [];
    gatewayIpc.getRouteUpdatesStream().subscribe((event) => events.push(event));
  });

  it('aponta para o Service mc-<subdomínio> no namespace configurado, na porta alocada', async () => {
    const reconciler = new ReconcilerService(
      {} as any,
      {} as any,
      config,
      {} as any,
      {} as any,
      gatewayIpc,
    );
    const servers = new ServersService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      gatewayIpc,
    );

    const snapshot = await gatewayIpc.getInitialRoutingSnapshot();
    await gatewayIpc.publishRoute(server.id);
    await gatewayIpc.handleWakeRequest(server.id);
    (servers as any).notifyGateway(server, 'READY');
    (reconciler as any).notifyGateway(server, 'STOPPED');

    expect(events.map((e) => e.action)).toEqual([
      RouteAction.UPSERT,
      RouteAction.STATUS_CHANGE,
      RouteAction.STATUS_CHANGE,
      RouteAction.STATUS_CHANGE,
    ]);
    const targets = new Set([...snapshot.routes, ...events].map((e) => e.target_ip_port));
    expect([...targets]).toEqual(['mc-hub.games.svc.cluster.local:25570']);

    const service = ManifestBuilder.buildService(server, config);
    const gamePort = service.spec.ports.find((p) => p.name === 'minecraft')!.port;
    expect([...targets][0]).toBe(
      `${service.metadata.name}.${service.metadata.namespace}.svc.cluster.local:${gamePort}`,
    );
  });
});
