import * as path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

import { GATEWAY_GRPC_LOADER_OPTIONS } from './grpc-loader-options';

const PROTO_PATH = path.resolve(__dirname, '../../../../proto/gateway_control.proto');

function loadService(options: protoLoader.Options) {
  const definition = protoLoader.loadSync(PROTO_PATH, options);
  const pkg = grpc.loadPackageDefinition(definition) as any;
  return pkg.minekubernetes.gateway.v1.GatewayControlService;
}

/** Servidor gRPC real no mesmo processo, carregado com as opções que o main.ts passa ao Nest. */
async function startServer(loaderOptions: protoLoader.Options, handlers: Record<string, any>) {
  const Service = loadService(loaderOptions);
  const server = new grpc.Server();
  server.addService(Service.service, {
    StreamRouteUpdates: () => undefined,
    RevokePlayerSession: () => undefined,
    ResolvePlayerIdentity: () => undefined,
    StreamSessionEvents: () => undefined,
    GetInitialRoutingSnapshot: () => undefined,
    ...handlers,
  });
  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, bound) =>
      err ? reject(err) : resolve(bound),
    ),
  );
  // O gateway (Rust/prost) fala pelo número do campo; o cliente aqui usa snake_case como o contrato.
  const Client = loadService({ keepCase: true, longs: Number });
  const client = new Client(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  return { server, client };
}

describe('Contrato gRPC com o Gateway (loader do main.ts)', () => {
  const closers: Array<() => void> = [];
  afterEach(() => closers.splice(0).forEach((close) => close()));

  it('entrega eventos de sessão em snake_case, com o timestamp como number', async () => {
    const received: any[] = [];
    const { server, client } = await startServer(GATEWAY_GRPC_LOADER_OPTIONS, {
      StreamSessionEvents: (call: any, callback: any) => {
        call.on('data', (message: any) => received.push(message));
        call.on('end', () => callback(null, {}));
      },
    });
    closers.push(() => server.forceShutdown(), () => client.close());

    await new Promise<void>((resolve, reject) => {
      const call = client.StreamSessionEvents((err: Error | null) => (err ? reject(err) : resolve()));
      call.write({
        event_type: 0,
        session_id: 's1',
        server_id: 'srv-1',
        client_ip: '100.64.0.2',
        minecraft_nick: 'Steve',
        timestamp_epoch_ms: 1760000000000,
      });
      call.end();
    });

    expect(received).toEqual([
      expect.objectContaining({
        event_type: 0,
        server_id: 'srv-1',
        minecraft_nick: 'Steve',
        timestamp_epoch_ms: 1760000000000,
      }),
    ]);
  });

  it('serializa o snapshot de rotas sem perder server_id, access_policy e auto_wake', async () => {
    const { server, client } = await startServer(GATEWAY_GRPC_LOADER_OPTIONS, {
      GetInitialRoutingSnapshot: (_call: any, callback: any) =>
        callback(null, {
          routes: [{ server_id: 'srv-1', subdomain: 'hub', access_policy: 'GROUP', auto_wake: true }],
        }),
    });
    closers.push(() => server.forceShutdown(), () => client.close());

    const snapshot: any = await new Promise((resolve, reject) =>
      client.GetInitialRoutingSnapshot({}, (err: Error | null, res: any) => (err ? reject(err) : resolve(res))),
    );

    expect(snapshot.routes[0]).toMatchObject({
      server_id: 'srv-1',
      subdomain: 'hub',
      access_policy: 'GROUP',
      auto_wake: true,
    });
  });

  it('sem as opções, o snapshot perderia os campos (documenta por que o loader é obrigatório)', async () => {
    const { server, client } = await startServer({}, {
      GetInitialRoutingSnapshot: (_call: any, callback: any) =>
        callback(null, { routes: [{ server_id: 'srv-1', subdomain: 'hub', access_policy: 'GROUP' }] }),
    });
    closers.push(() => server.forceShutdown(), () => client.close());

    const snapshot: any = await new Promise((resolve, reject) =>
      client.GetInitialRoutingSnapshot({}, (err: Error | null, res: any) => (err ? reject(err) : resolve(res))),
    );

    expect(snapshot.routes[0].server_id).toBeUndefined();
  });
});
