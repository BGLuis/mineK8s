import * as net from 'net';
import { HealthBotProbeService } from './health-bot-probe.service';
import { AppConfigService } from '@config/app-config.service';

describe('HealthBotProbeService (RF-ARQ-30, Milestone F9)', () => {
  let probeService: HealthBotProbeService;
  let mockConfigService: Partial<AppConfigService>;
  let server: net.Server | null = null;
  let serverPort: number;

  beforeEach(() => {
    mockConfigService = {
      healthBot: {
        enabled: true,
        intervalMs: 300000,
        timeoutMs: 3000,
      },
    };
    probeService = new HealthBotProbeService(mockConfigService as AppConfigService);
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  it('should roundtrip encode and decode VarInt and String correctly', () => {
    const testCases = [0, 1, 127, 128, 255, 765, 25565, 2097151];
    for (const val of testCases) {
      const encoded = probeService.encodeVarInt(val);
      const decoded = probeService.decodeVarInt(encoded, 0);
      expect(decoded.value).toBe(val);
    }

    const testStr = 'TestServerName123!';
    const encodedStr = probeService.encodeString(testStr);
    const decodedStr = probeService.decodeString(encodedStr, 0);
    expect(decodedStr.value).toBe(testStr);
  });

  it('should successfully verify full world spawn on online-mode=false server', async () => {
    server = net.createServer((socket) => {
      socket.on('data', () => {
        // 1. Send Login Success (Packet ID 0x02)
        const uuidBuf = Buffer.alloc(16, 1);
        const nameBuf = probeService.encodeString('__healthbot__');
        const numProps = probeService.encodeVarInt(0);
        const loginSuccessPayload = Buffer.concat([
          probeService.encodeVarInt(0x02),
          uuidBuf,
          nameBuf,
          numProps,
        ]);
        const loginSuccessPacket = Buffer.concat([
          probeService.encodeVarInt(loginSuccessPayload.length),
          loginSuccessPayload,
        ]);

        // 2. Send Login (Play) packet (Packet ID 0x29 in 1.20.4)
        const playPayload = Buffer.concat([
          probeService.encodeVarInt(0x29),
          Buffer.alloc(8, 0), // Entity ID & hardcore & dimensions
        ]);
        const playPacket = Buffer.concat([
          probeService.encodeVarInt(playPayload.length),
          playPayload,
        ]);

        socket.write(Buffer.concat([loginSuccessPacket, playPacket]));
      });
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        serverPort = (server!.address() as net.AddressInfo).port;
        resolve();
      });
    });

    const report = await probeService.probe({
      serverId: 'srv-offline-1',
      subdomain: 'survival-offline',
      host: '127.0.0.1',
      port: serverPort,
      timeoutMs: 2000,
    });

    expect(report.healthy).toBe(true);
    expect(report.stage).toBe('spawn_verified');
    expect(report.onlineMode).toBe(false);
    expect(report.latencies.tcpConnectMs).toBeGreaterThanOrEqual(0);
    expect(report.latencies.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(report.worldDetails?.dimension).toBe('minecraft:overworld');
  });

  it('should accept EncryptionRequest on online-mode=true server as valid health confirmation', async () => {
    server = net.createServer((socket) => {
      socket.on('data', () => {
        // Send Encryption Request (Packet ID 0x01 in Login state)
        const serverIdStr = probeService.encodeString('');
        const pubKey = probeService.encodeString('fake-pub-key');
        const verifyToken = probeService.encodeString('fake-token');

        const encPayload = Buffer.concat([
          probeService.encodeVarInt(0x01),
          serverIdStr,
          pubKey,
          verifyToken,
        ]);
        const encPacket = Buffer.concat([probeService.encodeVarInt(encPayload.length), encPayload]);

        socket.write(encPacket);
      });
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        serverPort = (server!.address() as net.AddressInfo).port;
        resolve();
      });
    });

    const report = await probeService.probe({
      serverId: 'srv-online-1',
      subdomain: 'survival-online',
      host: '127.0.0.1',
      port: serverPort,
      timeoutMs: 2000,
    });

    expect(report.healthy).toBe(true);
    expect(report.stage).toBe('encryption_challenge');
    expect(report.onlineMode).toBe(true);
    expect(report.latencies.loginLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle Disconnect (Login) packet and report error', async () => {
    server = net.createServer((socket) => {
      socket.on('data', () => {
        // Disconnect (Login) packet (Packet ID 0x00 in Login state)
        const reasonPayload = probeService.encodeString(
          JSON.stringify({ text: 'You are not whitelisted on this server' }),
        );
        const disconnectPayload = Buffer.concat([probeService.encodeVarInt(0x00), reasonPayload]);
        const disconnectPacket = Buffer.concat([
          probeService.encodeVarInt(disconnectPayload.length),
          disconnectPayload,
        ]);

        socket.write(disconnectPacket);
      });
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        serverPort = (server!.address() as net.AddressInfo).port;
        resolve();
      });
    });

    const report = await probeService.probe({
      serverId: 'srv-whitelisted',
      subdomain: 'private-world',
      host: '127.0.0.1',
      port: serverPort,
      timeoutMs: 2000,
    });

    expect(report.healthy).toBe(false);
    expect(report.stage).toBe('failed');
    expect(report.error).toContain('You are not whitelisted on this server');
  });

  it('should return failed report when server port is closed', async () => {
    const report = await probeService.probe({
      serverId: 'srv-offline',
      subdomain: 'crashed-world',
      host: '127.0.0.1',
      port: 19875,
      timeoutMs: 500,
    });

    expect(report.healthy).toBe(false);
    expect(report.stage).toBe('failed');
    expect(report.error).toContain('Socket connection error');
  });
});
