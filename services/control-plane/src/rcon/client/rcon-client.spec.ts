import * as net from 'net';
import { RconPacketCodec, RconPacketType } from '../codec/rcon-packet.codec';
import { RconClient, RconTimeoutException, RconAuthenticationException } from './rcon-client';

describe('RconClient (RF-RCON-03, RF-RCON-04, RF-RCON-05, RF-RCON-06, RF-RCON-15, Guarda L-08)', () => {
  let server: net.Server;
  let serverPort: number;
  let lastServerClientSocket: net.Socket | null = null;
  const password = 'test-rcon-secret';

  beforeEach((done) => {
    server = net.createServer((socket) => {
      lastServerClientSocket = socket;
      let acc = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        acc = Buffer.concat([acc, chunk]);
        while (acc.length >= 14) {
          const decoded = RconPacketCodec.decode(acc);
          if (!decoded) break;
          acc = acc.subarray(decoded.bytesConsumed);

          const { packet } = decoded;
          if (packet.type === RconPacketType.SERVERDATA_AUTH) {
            if (packet.body === password) {
              // Auth success: echo request ID with type 2
              const resp = RconPacketCodec.encode({
                id: packet.id,
                type: RconPacketType.SERVERDATA_AUTH_RESPONSE,
                body: '',
              });
              socket.write(resp);
            } else {
              // Auth failure: response ID = -1
              const resp = RconPacketCodec.encode({
                id: -1,
                type: RconPacketType.SERVERDATA_AUTH_RESPONSE,
                body: '',
              });
              socket.write(resp);
            }
          } else if (packet.type === RconPacketType.SERVERDATA_EXECCOMMAND) {
            // Echo command or response
            let responseText = `Executed: ${packet.body}`;
            if (packet.body === 'save-all flush') {
              responseText = 'Saved the game';
            }
            if (packet.body === 'hang_forever') {
              // Simulate hung JVM tick: do not respond
              return;
            }

            const resp = RconPacketCodec.encode({
              id: packet.id,
              type: RconPacketType.SERVERDATA_RESPONSE_VALUE,
              body: responseText,
            });
            socket.write(resp);
          }
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      serverPort = addr.port;
      done();
    });
  });

  afterEach((done) => {
    if (lastServerClientSocket) {
      lastServerClientSocket.destroy();
      lastServerClientSocket = null;
    }
    server.close(() => done());
  });

  it('test_rcon_connect_and_authenticate: should connect and authenticate successfully', async () => {
    const client = new RconClient({
      serverId: 'srv-1',
      host: '127.0.0.1',
      port: serverPort,
      password,
    });

    await client.connect();
    expect(client.isConnected()).toBe(true);

    const response = await client.sendCommand('list');
    expect(response).toBe('Executed: list');

    client.destroy();
  });

  it('test_rcon_auth_failure: should reject on invalid password', async () => {
    const client = new RconClient({
      serverId: 'srv-invalid-auth',
      host: '127.0.0.1',
      port: serverPort,
      password: 'wrong-password',
      autoReconnect: false,
    });

    await expect(client.connect()).rejects.toThrow(RconAuthenticationException);
    expect(client.isConnected()).toBe(false);

    client.destroy();
  });

  it('test_rcon_single_flight_fifo_queue: should execute commands in sequential FIFO order (RF-RCON-04)', async () => {
    const client = new RconClient({
      serverId: 'srv-fifo',
      host: '127.0.0.1',
      port: serverPort,
      password,
    });

    await client.connect();

    // Dispatch 5 concurrent commands without awaiting sequentially
    const p1 = client.sendCommand('cmd1');
    const p2 = client.sendCommand('cmd2');
    const p3 = client.sendCommand('cmd3');
    const p4 = client.sendCommand('cmd4');
    const p5 = client.sendCommand('cmd5');

    const results = await Promise.all([p1, p2, p3, p4, p5]);
    expect(results).toEqual([
      'Executed: cmd1',
      'Executed: cmd2',
      'Executed: cmd3',
      'Executed: cmd4',
      'Executed: cmd5',
    ]);

    client.destroy();
  });

  it('test_rcon_command_timeout_and_abort: should timeout and destroy socket on hung command (RF-RCON-05, L-08)', async () => {
    const client = new RconClient({
      serverId: 'srv-timeout',
      host: '127.0.0.1',
      port: serverPort,
      password,
      defaultTimeoutMs: 150, // Short timeout for unit test
      autoReconnect: false,
    });

    await client.connect();

    await expect(client.sendCommand('hang_forever')).rejects.toThrow(RconTimeoutException);
    expect(client.isConnected()).toBe(false);

    client.destroy();
  });

  it('test_rcon_custom_timeout_preset_l08: should support extended timeout parameter for long commands (Guarda L-08)', async () => {
    const client = new RconClient({
      serverId: 'srv-preset',
      host: '127.0.0.1',
      port: serverPort,
      password,
      defaultTimeoutMs: 100, // standard default
    });

    await client.connect();

    // Execute with extended timeout parameter (e.g. 1000ms instead of 100ms)
    const res = await client.sendCommand('save-all flush', 1000);
    expect(res).toBe('Saved the game');

    client.destroy();
  });

  it('test_rcon_pool_reconnect_on_socket_drop: should automatically reconnect and reauthenticate when connection drops (RF-RCON-06, RF-RCON-15)', async () => {
    const client = new RconClient({
      serverId: 'srv-reconnect',
      host: '127.0.0.1',
      port: serverPort,
      password,
      baseBackoffMs: 50, // Fast backoff for test
      maxBackoffMs: 200,
      autoReconnect: true,
    });

    await client.connect();
    expect(client.isConnected()).toBe(true);

    // Initial command passes
    const resp1 = await client.sendCommand('first');
    expect(resp1).toBe('Executed: first');

    // Simulate abrupt socket drop from server JVM (e.g. crash or restart)
    expect(lastServerClientSocket).not.toBeNull();
    lastServerClientSocket?.destroy();

    // Wait for client to detect close, trigger backoff timer and reconnect
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Client should have successfully reconnected and reauthenticated!
    expect(client.isConnected()).toBe(true);

    // Subsequent command should work flawlessly
    const resp2 = await client.sendCommand('second');
    expect(resp2).toBe('Executed: second');

    client.destroy();
  });

  it('destroy settles a connect that is still in flight, so its caller is not left waiting forever', async () => {
    // A socket that never connects nor fails, like a DNS lookup that is still pending.
    const stalledSocket = new net.Socket();
    jest.spyOn(stalledSocket, 'connect').mockImplementation(() => stalledSocket);
    const client = new RconClient({
      serverId: 'srv-stalled',
      host: 'mc-stalled.minekubernetes.svc.cluster.local',
      port: 25575,
      password,
      createSocket: () => stalledSocket,
    });

    const connecting = client.connect();
    client.destroy();

    await expect(connecting).rejects.toThrow('RconClient destroyed');
  });
});
