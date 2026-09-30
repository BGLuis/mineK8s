import { HealthBotSchedulerService } from './health-bot-scheduler.service';
import { HealthBotProbeService, HealthBotReport } from './health-bot-probe.service';
import { AppConfigService } from '@config/app-config.service';
import { Server } from '@database/entities/server.entity';
import { Repository } from 'typeorm';

describe('HealthBotSchedulerService (RF-ARQ-30, Milestone F9)', () => {
  let schedulerService: HealthBotSchedulerService;
  let mockServerRepo: Partial<Repository<Server>>;
  let mockProbeService: Partial<HealthBotProbeService>;
  let mockConfigService: Partial<AppConfigService>;

  const createDummyReport = (
    serverId: string,
    healthy: boolean = true,
    totalDurationMs: number = 100,
  ): HealthBotReport => ({
    id: `report-${Date.now()}-${Math.random()}`,
    serverId,
    subdomain: `sub-${serverId}`,
    timestamp: new Date(),
    healthy,
    stage: healthy ? 'spawn_verified' : 'failed',
    onlineMode: false,
    latencies: {
      tcpConnectMs: 10,
      handshakeLatencyMs: 20,
      loginLatencyMs: 30,
      spawnLatencyMs: 40,
      totalDurationMs,
    },
    error: healthy ? undefined : 'Connection refused',
  });

  beforeEach(() => {
    mockServerRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    mockProbeService = {
      probe: jest.fn(),
    };

    mockConfigService = {
      isTest: true,
      healthBot: {
        enabled: true,
        intervalMs: 300000,
        timeoutMs: 3000,
      },
      kubernetes: {
        inCluster: false,
        namespace: 'minekubernetes',
        nodeAffinityKey: 'kubernetes.io/hostname',
        useMockDriver: true,
      },
    };

    schedulerService = new HealthBotSchedulerService(
      mockServerRepo as Repository<Server>,
      mockProbeService as HealthBotProbeService,
      mockConfigService as AppConfigService,
    );
  });

  afterEach(() => {
    schedulerService.onModuleDestroy();
  });

  it('should probe a specific server and store the report in memory', async () => {
    const mockServer = {
      id: 'srv-1',
      subdomain: 'survival',
      allocated_port: 25565,
      game_type: 'minecraft',
      state: 'READY',
    } as Server;

    (mockServerRepo.findOne as jest.Mock).mockResolvedValue(mockServer);

    const dummyReport = createDummyReport('srv-1', true, 85);
    (mockProbeService.probe as jest.Mock).mockResolvedValue(dummyReport);

    const report = await schedulerService.probeServer('srv-1');

    expect(mockServerRepo.findOne).toHaveBeenCalledWith({ where: { id: 'srv-1' } });
    expect(mockProbeService.probe).toHaveBeenCalledWith({
      serverId: 'srv-1',
      subdomain: 'survival',
      host: '127.0.0.1',
      port: 25565,
      timeoutMs: 3000,
    });
    expect(report).toBe(dummyReport);

    const reports = schedulerService.getReports('srv-1');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toBe(dummyReport);
    expect(schedulerService.getLatestReport('srv-1')).toBe(dummyReport);
  });

  it('should throw error when probing non-existent server', async () => {
    (mockServerRepo.findOne as jest.Mock).mockResolvedValue(null);

    await expect(schedulerService.probeServer('srv-nonexistent')).rejects.toThrow(
      'Server with ID srv-nonexistent not found',
    );
  });

  it('should run scheduled probes only on READY Minecraft servers', async () => {
    const mockServers = [
      { id: 'srv-1', subdomain: 'world1', state: 'READY', game_type: 'minecraft' },
      { id: 'srv-2', subdomain: 'world2', state: 'READY', game_type: 'terraria' }, // Non-minecraft
    ] as Server[];

    (mockServerRepo.find as jest.Mock).mockResolvedValue(mockServers);
    (mockServerRepo.findOne as jest.Mock).mockImplementation(({ where }) => {
      const found = mockServers.find((s) => s.id === where.id);
      return Promise.resolve(found || null);
    });

    const dummyReport = createDummyReport('srv-1', true);
    (mockProbeService.probe as jest.Mock).mockResolvedValue(dummyReport);

    const results = await schedulerService.runScheduledProbes();

    expect(results).toHaveLength(1);
    expect(results[0].serverId).toBe('srv-1');
  });

  it('should limit circular buffer to 50 reports per server and discard older ones', () => {
    for (let i = 0; i < 55; i++) {
      const rep = createDummyReport('srv-limit', true, i);
      schedulerService.storeReport('srv-limit', rep);
    }

    const reports = schedulerService.getReports('srv-limit', 100);
    expect(reports).toHaveLength(50);
    // Newest is first
    expect(reports[0].latencies.totalDurationMs).toBe(54);
    // Oldest preserved is 5 (0-4 were popped)
    expect(reports[49].latencies.totalDurationMs).toBe(5);
  });

  it('should aggregate metrics and return overview across all servers', async () => {
    const mockServers = [
      { id: 'srv-1', subdomain: 'world1', state: 'READY' },
      { id: 'srv-2', subdomain: 'world2', state: 'STOPPED' },
    ] as Server[];

    (mockServerRepo.find as jest.Mock).mockResolvedValue(mockServers);

    // srv-1: 2 successful checks, avg latency 100ms
    schedulerService.storeReport('srv-1', createDummyReport('srv-1', true, 100));
    schedulerService.storeReport('srv-1', createDummyReport('srv-1', true, 100));

    // srv-2: 1 failed check
    schedulerService.storeReport('srv-2', createDummyReport('srv-2', false, 50));

    const overview = await schedulerService.getOverview();

    expect(overview.totalMonitoredServers).toBe(2);
    expect(overview.healthyServers).toBe(1);
    expect(overview.unhealthyServers).toBe(1);

    expect(overview.servers['srv-1'].uptimePercentage).toBe(100);
    expect(overview.servers['srv-1'].avgTotalDurationMs).toBe(100);
    expect(overview.servers['srv-1'].totalChecks).toBe(2);

    expect(overview.servers['srv-2'].uptimePercentage).toBe(0);
    expect(overview.servers['srv-2'].totalChecks).toBe(1);
  });
});
