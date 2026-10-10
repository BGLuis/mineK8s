import * as net from 'net';
import { MinecraftSlpProbeService } from './minecraft-slp-probe.service';

describe('MinecraftSlpProbeService (RF-ARQ-04, C-14)', () => {
  let probeService: MinecraftSlpProbeService;
  let server: net.Server | null = null;
  let serverPort: number;

  beforeEach(() => {
    probeService = new MinecraftSlpProbeService();
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  it('should support minecraft game type', () => {
    expect(probeService.supports('minecraft')).toBe(true);
    expect(probeService.supports('MINECRAFT')).toBe(true);
    expect(probeService.supports('')).toBe(true);
    expect(probeService.supports('terraria')).toBe(false);
  });

  it('should roundtrip encode and decode VarInt correctly', () => {
    const testCases = [0, 1, 127, 128, 255, 25565, 2097151];
    for (const val of testCases) {
      const encoded = probeService.encodeVarInt(val);
      const decoded = probeService.decodeVarInt(encoded, 0);
      expect(decoded.value).toBe(val);
    }
  });

  it('should successfully probe a mock Minecraft server responding with valid SLP JSON', async () => {
    const mockResponseJson = JSON.stringify({
      version: {
        name: 'Paper 1.20.4',
        protocol: 765,
      },
      players: {
        max: 20,
        online: 3,
      },
      description: {
        text: 'A MineKubernetes Test Server',
      },
    });

    server = net.createServer((socket) => {
      socket.on('data', (_data) => {
        // Build packet: packet_len, packet_id (0x00), json_str_len, json_str
        const jsonBuf = Buffer.from(mockResponseJson, 'utf8');
        const jsonLenBuf = probeService.encodeVarInt(jsonBuf.length);
        const packetIdBuf = probeService.encodeVarInt(0x00);
        const payload = Buffer.concat([packetIdBuf, jsonLenBuf, jsonBuf]);
        const packetLenBuf = probeService.encodeVarInt(payload.length);

        socket.write(Buffer.concat([packetLenBuf, payload]));
      });
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        serverPort = (server!.address() as net.AddressInfo).port;
        resolve();
      });
    });

    const res = await probeService.probe('127.0.0.1', serverPort, 2000);
    expect(res.ready).toBe(true);
    expect(res.version).toBe('Paper 1.20.4');
    expect(res.protocol).toBe(765);
    expect(res.playersOnline).toBe(3);
    expect(res.maxPlayers).toBe(20);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should return ready: false when socket connection fails (port closed)', async () => {
    // Port 1 is typically closed/unreachable
    const res = await probeService.probe('127.0.0.1', 19876, 500);
    expect(res.ready).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('should return ready: false when server returns invalid JSON', async () => {
    server = net.createServer((socket) => {
      socket.on('data', () => {
        const payload = Buffer.concat([
          probeService.encodeVarInt(0x00),
          probeService.encodeString('INVALID_JSON_CONTENT'),
        ]);
        const packet = Buffer.concat([probeService.encodeVarInt(payload.length), payload]);
        socket.write(packet);
      });
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        serverPort = (server!.address() as net.AddressInfo).port;
        resolve();
      });
    });

    const res = await probeService.probe('127.0.0.1', serverPort, 2000);
    expect(res.ready).toBe(false);
    expect(res.error).toContain('Failed to parse SLP response');
  });
});
