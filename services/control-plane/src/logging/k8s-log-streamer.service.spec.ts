import { Readable } from 'stream';
import { AppConfigService } from '../config/app-config.service';
import { K8sLogStreamerService } from './k8s-log-streamer.service';

describe('K8sLogStreamerService (RF-RCON-07, RF-RCON-08, RF-RCON-09, Guarda C-11)', () => {
  let streamer: K8sLogStreamerService;
  let mockConfigService: jest.Mocked<AppConfigService>;

  beforeEach(() => {
    mockConfigService = {
      kubernetes: {
        namespace: 'minekubernetes',
        useMockDriver: true,
      },
    } as any;

    streamer = new K8sLogStreamerService(mockConfigService);
  });

  afterEach(() => {
    streamer.onModuleDestroy();
  });

  it('should initialize and return circular buffer for server', () => {
    const buffer = streamer.getBuffer('srv-stream-1');
    expect(buffer).toBeDefined();
    expect(buffer.size()).toBe(0);
  });

  it('should filter noise and dispatch log_delta to subscribed listeners', () => {
    const deltas: any[] = [];
    const unsubscribe = streamer.subscribeToDeltas('srv-stream-1', (entry) => {
      deltas.push(entry);
    });

    // 1. Ingest normal game log
    const entry1 = streamer.ingestRawLine(
      'srv-stream-1',
      '[10:00:00 INFO]: Preparing spawn area: 100%',
    );
    expect(entry1).not.toBeNull();
    expect(deltas.length).toBe(1);
    expect(deltas[0].message).toContain('Preparing spawn area: 100%');
    expect(entry1?.source).toBe('stdout');

    // 2. Ingest RCON noise line -> must be filtered, no delta emitted
    const noiseEntry = streamer.ingestRawLine(
      'srv-stream-1',
      'Thread RCON Client /127.0.0.1:45000 started',
    );
    expect(noiseEntry).toBeNull();
    expect(deltas.length).toBe(1);

    // 3. Ingest player chat with RCON mention -> must NOT be filtered
    const chatEntry = streamer.ingestRawLine(
      'srv-stream-1',
      '[10:01:00 INFO]: <Steve> Estou testando o rcon agora!',
    );
    expect(chatEntry).not.toBeNull();
    expect(deltas.length).toBe(2);

    // Verify buffer has 2 items (noise was not inserted)
    const buffer = streamer.getBuffer('srv-stream-1');
    expect(buffer.size()).toBe(2);

    unsubscribe();
  });

  it('should stream data line-by-line from a Readable stream', async () => {
    const readable = new Readable({
      read() {
        this.push('[12:00:01 INFO]: Server started\n');
        this.push('Thread RCON Client /10.0.0.1:1234 shut down\n');
        this.push('[12:00:02 INFO]: Player joined\n');
        this.push(null);
      },
    });

    await streamer.attachServerStream('srv-stream-2', 'survival', async () => readable);

    // Give a tick for stream reading
    await new Promise((r) => setTimeout(r, 50));

    const history = streamer.getBuffer('srv-stream-2').getHistory();
    expect(history.length).toBe(2);
    expect(history[0].message).toContain('Server started');
    expect(history[1].message).toContain('Player joined');
  });

  it('should detach stream on request', async () => {
    const readable = new Readable({
      read() {},
    });

    await streamer.attachServerStream('srv-stream-3', 'creative', async () => readable);
    streamer.detachServerStream('srv-stream-3');
    // Buffer remains accessible
    expect(streamer.getBuffer('srv-stream-3')).toBeDefined();
  });
});
