const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const PROTO_PATH = path.resolve(__dirname, '../../../../proto/gateway_control.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const gatewayService = protoDescriptor.minekubernetes.gateway.v1.GatewayControlService.service;

const server = new grpc.Server();

server.addService(gatewayService, {
  GetInitialRoutingSnapshot: (call, callback) => {
    callback(null, {
      routes: [
        {
          action: 'UPSERT',
          server_id: 'srv-e2e-live',
          subdomain: 'e2e.mine.lan',
          target_ip_port: '10.0.0.50:25565',
          status: 'READY',
          access_policy: 'PUBLIC',
          allowed_group_ids: [],
          allowed_user_ids: [],
          proxy_protocol: true,
          game_type: 'MINECRAFT',
          routing_model: 'VirtualHost',
          listen_port: 25565,
        },
      ],
    });
  },
  StreamRouteUpdates: (call) => {
    // Send one update then finish
    call.write({
      action: 'UPSERT',
      server_id: 'srv-dynamic-live',
      subdomain: 'dynamic.mine.lan',
      target_ip_port: '10.0.0.51:25565',
      status: 'READY',
      access_policy: 'PUBLIC',
      allowed_group_ids: [],
      allowed_user_ids: [],
      proxy_protocol: false,
      game_type: 'MINECRAFT',
      routing_model: 'VirtualHost',
      listen_port: 25565,
    });
  },
  ResolvePlayerIdentity: (call, callback) => {
    const req = call.request;
    if (req.tailscale_user_id === 'user-e2e-123') {
      callback(null, {
        found: true,
        user_id: 'usr-e2e-real',
        minecraft_nick: 'E2EPlayer',
        role: 'ADMIN',
        group_ids: ['grp-e2e'],
        is_active: true,
        is_mojang_verified: true,
      });
    } else {
      callback(null, { found: false });
    }
  },
  RevokePlayerSession: (call, callback) => {
    callback(null, { session_found: true, terminated_connections_count: 1 });
  },
});

server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) {
    console.error('Failed to bind:', err);
    process.exit(1);
  }
  console.log(`READY_PORT:${port}`);
});
