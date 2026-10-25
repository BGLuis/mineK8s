import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ServerActivityBus } from '../server-events/server-activity.bus';
import { ServerStatsService } from './server-stats.service';

const TICK_QUERY = [
  'The game is running normally',
  'Target tick rate: 20.0 per second.',
  'Average time per tick: 25.0ms (Target: 50.0ms)',
  'Percentiles: P50: 20.0ms P95: 45.0ms P99: 90.0ms, sample: 100',
].join('\n');

describe('ServerStatsService', () => {
  const ready = { id: 'srv-1', subdomain: 'alpha', state: 'READY', allocated_memory_mb: 4096 };
  let servers: any[];
  let commands: Record<string, string | Error>;
  let podStats: any;
  let service: ServerStatsService;
  let published: { id: string; kind: string }[];

  beforeEach(() => {
    servers = [ready];
    commands = {
      tps: 'TPS from last 1m, 5m, 15m: *19.5, 20.0, 20.0',
      'tick query': TICK_QUERY,
    };
    podStats = {
      startedAt: new Date(Date.now() - 90_000),
      memoryUsedBytes: 3072 * 1024 ** 2,
      memoryLimitBytes: 5632 * 1024 ** 2,
    };

    const repo = {
      find: jest.fn(async () => servers.filter((s) => s.state === 'READY')),
      findOne: jest.fn(async ({ where }: any) => servers.find((s) => s.id === where.id) ?? null),
    };
    const k8s = { getServerPodStats: jest.fn(async () => podStats) };
    const consoleDriver = {
      sendCommand: jest.fn(async (_server: unknown, command: string) => {
        const output = commands[command];
        if (output instanceof Error) {
          throw output;
        }
        return output;
      }),
    };
    const bus = new ServerActivityBus();
    published = [];
    bus.events$.subscribe((event) => published.push(event));
    service = new ServerStatsService(
      repo as any,
      k8s as any,
      consoleDriver as any,
      { isTest: true, serverStatsIntervalMs: 60000 } as any,
      bus,
    );
  });

  it('reports the latest reading, the container memory and the uptime of a running server', async () => {
    await service.collect();

    const stats = await service.getStats('srv-1');

    expect(stats).toMatchObject({
      window: '60m',
      tps: 19.5,
      mspt: 25,
      memoryUsedMb: 3072,
      memoryLimitMb: 5632,
    });
    expect(stats.uptimeSeconds).toBeGreaterThanOrEqual(90);
    expect(stats.history).toHaveLength(1);
  });

  it('reports the tick percentiles and the configured heap, so the panel can tell spikes and heap from overhead', async () => {
    await service.collect();

    const stats = await service.getStats('srv-1');

    expect(stats).toMatchObject({ msptP95: 45, msptP99: 90, heapMb: 4096 });
    expect(stats.history[0].msptP95).toBe(45);
  });

  it('avisa o painel a cada amostra nova, e não quando nada respondeu', async () => {
    await service.collect();
    expect(published).toEqual([{ id: 'srv-1', kind: 'stats' }]);

    published.length = 0;
    commands = { tps: new Error('timeout'), 'tick query': new Error('timeout') };
    podStats = { startedAt: null, memoryUsedBytes: null, memoryLimitBytes: null };
    await service.collect();
    expect(published).toEqual([]);
  });

  it('accumulates one sample per collection', async () => {
    await service.collect();
    await service.collect();

    expect((await service.getStats('srv-1')).history).toHaveLength(2);
  });

  it('derives TPS from `tick query` on a vanilla server that has no `tps` command', async () => {
    commands.tps = new Error('Unknown or incomplete command');

    const stats = await (async () => {
      await service.collect();
      return service.getStats('srv-1');
    })();

    expect(stats.tps).toBe(20);
    expect(stats.mspt).toBe(25);
  });

  it('keeps memory when RCON is unreachable, so the panel is not blank during boot', async () => {
    commands.tps = new Error('ECONNREFUSED');
    commands['tick query'] = new Error('ECONNREFUSED');

    await service.collect();
    const stats = await service.getStats('srv-1');

    expect(stats.tps).toBeNull();
    expect(stats.memoryUsedMb).toBe(3072);
    expect(stats.history).toHaveLength(1);
  });

  it('records nothing when no source answered', async () => {
    commands.tps = new Error('down');
    commands['tick query'] = new Error('down');
    podStats = null;

    await service.collect();

    expect((await service.getStats('srv-1')).history).toEqual([]);
  });

  it('returns an empty series for a stopped server even if it ran before', async () => {
    await service.collect();
    servers[0] = { ...ready, state: 'STOPPED' };

    const stats = await service.getStats('srv-1');

    expect(stats.history).toEqual([]);
    expect(stats.tps).toBeNull();

    await service.collect();
    servers[0] = ready;
    await service.collect();
    expect((await service.getStats('srv-1')).history).toHaveLength(1);
  });

  it('only returns samples inside the requested window', async () => {
    jest.useFakeTimers();
    try {
      await service.collect();
      jest.setSystemTime(Date.now() + 10 * 60_000);
      await service.collect();

      expect((await service.getStats('srv-1', '5m')).history).toHaveLength(1);
      expect((await service.getStats('srv-1', '60m')).history).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['0m', '61m', '60', 'abc', '5h'])('rejects the window "%s"', async (window) => {
    await expect(service.getStats('srv-1', window)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('answers 404 for an unknown server', async () => {
    await expect(service.getStats('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
