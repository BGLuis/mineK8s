import { HealthBotController } from './health-bot.controller';
import { HealthBotSchedulerService } from './health-bot-scheduler.service';

describe('HealthBotController (RF-ARQ-30, Milestone F9)', () => {
  let controller: HealthBotController;
  let mockSchedulerService: Partial<HealthBotSchedulerService>;

  beforeEach(() => {
    mockSchedulerService = {
      getOverview: jest.fn().mockResolvedValue({
        totalMonitoredServers: 1,
        healthyServers: 1,
        unhealthyServers: 0,
        servers: {},
      }),
      getReports: jest.fn().mockReturnValue([
        {
          id: 'rep-1',
          serverId: 'srv-1',
          subdomain: 'test-server',
          timestamp: new Date(),
          healthy: true,
          stage: 'spawn_verified',
          onlineMode: false,
          latencies: {
            tcpConnectMs: 5,
            handshakeLatencyMs: 10,
            loginLatencyMs: 15,
            spawnLatencyMs: 20,
            totalDurationMs: 50,
          },
        },
      ]),
      probeServer: jest.fn().mockResolvedValue({
        id: 'rep-manual',
        serverId: 'srv-1',
        subdomain: 'test-server',
        timestamp: new Date(),
        healthy: true,
        stage: 'spawn_verified',
        onlineMode: false,
        latencies: {
          tcpConnectMs: 5,
          handshakeLatencyMs: 10,
          loginLatencyMs: 15,
          spawnLatencyMs: 20,
          totalDurationMs: 50,
        },
      }),
    };

    controller = new HealthBotController(mockSchedulerService as HealthBotSchedulerService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return global overview from scheduler', async () => {
    const res = await controller.getOverview();
    expect(mockSchedulerService.getOverview).toHaveBeenCalled();
    expect(res.totalMonitoredServers).toBe(1);
    expect(res.healthyServers).toBe(1);
  });

  it('should return historical reports for a specific server', async () => {
    const res = await controller.getReports('srv-1', 10);
    expect(mockSchedulerService.getReports).toHaveBeenCalledWith('srv-1', 10);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('rep-1');
  });

  it('should default limit to 20 when not specified or invalid', async () => {
    await controller.getReports('srv-1');
    expect(mockSchedulerService.getReports).toHaveBeenCalledWith('srv-1', 20);

    await controller.getReports('srv-1', 'not-a-number' as any);
    expect(mockSchedulerService.getReports).toHaveBeenCalledWith('srv-1', 20);
  });

  it('should trigger an on-demand probe and return report', async () => {
    const res = await controller.triggerProbe('srv-1');
    expect(mockSchedulerService.probeServer).toHaveBeenCalledWith('srv-1');
    expect(res.id).toBe('rep-manual');
    expect(res.healthy).toBe(true);
  });
});
