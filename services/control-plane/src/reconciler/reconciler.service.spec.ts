import { Server } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { ReconcilerService } from './reconciler.service';

describe('ReconcilerService (RF-ARQ-01..06, RF-ARQ-25 - Lifecycle & Reconciler Loop)', () => {
  let reconciler: ReconcilerService;
  let mockServerRepo: any;
  let mockK8sService: any;
  let mockConfigService: any;
  let mockSlpProbeService: any;
  let mockGenericTcpProbeService: any;
  let mockGatewayIpcService: any;

  let serversDb: Map<string, Server>;
  let clusterDeployments: Map<string, any>;

  beforeEach(() => {
    serversDb = new Map();
    clusterDeployments = new Map();

    mockServerRepo = {
      find: jest.fn(async () => Array.from(serversDb.values())),
      save: jest.fn(async (server: Server) => {
        serversDb.set(server.id, server);
        return server;
      }),
    };

    mockK8sService = {
      listDeployments: jest.fn(async () => Array.from(clusterDeployments.values())),
      provisionServer: jest.fn(async (server: Server) => {
        clusterDeployments.set(`mc-${server.subdomain}`, {
          name: `mc-${server.subdomain}`,
          replicas: server.state === 'READY' ? 1 : 0,
          status: { readyReplicas: server.state === 'READY' ? 1 : 0 },
        });
      }),
      startServer: jest.fn(async (server: Server) => {
        const dep = clusterDeployments.get(`mc-${server.subdomain}`);
        if (dep) {
          dep.replicas = 1;
          dep.status.readyReplicas = 1;
        }
      }),
      stopServer: jest.fn(async (server: Server) => {
        const dep = clusterDeployments.get(`mc-${server.subdomain}`);
        if (dep) {
          dep.replicas = 0;
          dep.status.readyReplicas = 0;
        }
      }),
      restartServer: jest.fn(async (server: Server) => {
        const dep = clusterDeployments.get(`mc-${server.subdomain}`);
        if (dep) {
          dep.replicas = 1;
          dep.status.readyReplicas = 0; // simulating starting
        }
      }),
    };

    mockConfigService = {
      isTest: true,
      reconciliationIntervalMs: 30000,
      kubernetes: {
        namespace: 'minekubernetes',
      },
    };

    mockSlpProbeService = {
      supports: jest.fn(() => true),
      probe: jest.fn(async () => ({
        ready: true,
        version: 'Paper 1.20.4',
        playersOnline: 0,
        maxPlayers: 20,
      })),
    };

    mockGenericTcpProbeService = {
      supports: jest.fn(() => false),
      probe: jest.fn(async () => ({ ready: true })),
    };

    mockGatewayIpcService = {
      broadcastRouteUpdate: jest.fn(),
      routeTarget: jest.fn(
        (server: Server) => `mc-${server.subdomain}.minekubernetes.svc.cluster.local:25565`,
      ),
    };

    reconciler = new ReconcilerService(
      mockServerRepo,
      mockK8sService,
      mockConfigService,
      mockSlpProbeService,
      mockGenericTcpProbeService,
      mockGatewayIpcService,
    );
  });

  describe('host do probe', () => {
    const server = { subdomain: 'survival' } as Server;

    it('usa o DNS do Service no cluster', () => {
      mockConfigService.isTest = false;

      expect(reconciler.getProbeHost(server)).toBe('mc-survival.minekubernetes.svc.cluster.local');
    });

    it('usa 127.0.0.1 com o driver k8s simulado, o mesmo host que o pool RCON usa', () => {
      mockConfigService.isTest = false;
      mockConfigService.kubernetes.useMockDriver = true;

      expect(reconciler.getProbeHost(server)).toBe('127.0.0.1');
    });
  });

  describe('Acceptance Criterion: Apagar um Deployment à mão é corrigido no próximo ciclo (RF-ARQ-25)', () => {
    it('should detect manually deleted deployment and auto-heal by reprovisioning it', async () => {
      const server: Server = {
        id: 'srv-smp-1',
        name: 'Survival SMP',
        subdomain: 'smp',
        state: 'READY',
        restart_count: 0,
        last_restart_at: null,
        minecraft_settings: { motd: 'Auto heal test' } as MinecraftServerSettings,
      } as Server;
      serversDb.set(server.id, server);

      expect(clusterDeployments.has('mc-smp')).toBe(false);

      const summary = await reconciler.reconcile();

      expect(summary.checked).toBe(1);
      expect(summary.healedDeployments).toContain('mc-smp');
      expect(mockK8sService.provisionServer).toHaveBeenCalledWith(
        server,
        server.minecraft_settings,
      );
      expect(clusterDeployments.has('mc-smp')).toBe(true);
    });
  });

  describe('Replica drift reconciliation', () => {
    it('should scale deployment to 1 when DB desired state is READY but cluster has 0 replicas', async () => {
      const server: Server = {
        id: 'srv-smp-1',
        name: 'Survival SMP',
        subdomain: 'smp',
        state: 'READY',
        restart_count: 0,
        last_restart_at: null,
      } as Server;
      serversDb.set(server.id, server);

      clusterDeployments.set('mc-smp', {
        name: 'mc-smp',
        replicas: 0,
        status: { readyReplicas: 0 },
      });

      const summary = await reconciler.reconcile();

      expect(summary.reconciledReplicas).toContain('mc-smp');
      expect(mockK8sService.startServer).toHaveBeenCalledWith(server);
    });

    it('should scale deployment to 0 when DB desired state is STOPPED but cluster has 1 replica', async () => {
      const server: Server = {
        id: 'srv-smp-1',
        name: 'Survival SMP',
        subdomain: 'smp',
        state: 'STOPPED',
        restart_count: 0,
        last_restart_at: null,
      } as Server;
      serversDb.set(server.id, server);

      clusterDeployments.set('mc-smp', {
        name: 'mc-smp',
        replicas: 1,
        status: { readyReplicas: 1 },
      });

      const summary = await reconciler.reconcile();

      expect(summary.reconciledReplicas).toContain('mc-smp');
      expect(mockK8sService.stopServer).toHaveBeenCalledWith(server);
    });
  });

  describe('Observed status promotion with SLP Probe (RF-ARQ-04, C-14)', () => {
    it('should promote server from STARTING to READY only when SLP probe succeeds', async () => {
      const server: Server = {
        id: 'srv-smp-1',
        name: 'Survival SMP',
        subdomain: 'smp',
        state: 'STARTING',
        restart_count: 1,
        last_restart_at: new Date(),
      } as Server;
      serversDb.set(server.id, server);

      clusterDeployments.set('mc-smp', {
        name: 'mc-smp',
        replicas: 1,
        status: { readyReplicas: 1 },
      });

      const summary = await reconciler.reconcile();

      expect(summary.stateTransitions).toContain('smp: STARTING -> READY');
      expect(server.state).toBe('READY');
      expect(server.restart_count).toBe(0);
      expect(mockGatewayIpcService.broadcastRouteUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: server.id,
          status: 'READY',
        }),
      );
    });

    it('should remain in STARTING if pod is ready in K8s but SLP probe fails', async () => {
      const server: Server = {
        id: 'srv-smp-1',
        name: 'Survival SMP',
        subdomain: 'smp',
        state: 'STARTING',
        restart_count: 0,
        last_restart_at: null,
        updated_at: new Date(),
      } as Server;
      serversDb.set(server.id, server);

      clusterDeployments.set('mc-smp', {
        name: 'mc-smp',
        replicas: 1,
        status: { readyReplicas: 1 },
      });

      mockSlpProbeService.probe.mockResolvedValueOnce({
        ready: false,
        error: 'Engine world not loaded yet',
      });

      const summary = await reconciler.reconcile();

      expect(summary.stateTransitions).toHaveLength(0);
      expect(server.state).toBe('STARTING');
    });
  });

  describe('Liveness Watchdog and Deadlock Detection (RF-ARQ-05)', () => {
    it('should detect deadlock after 3 consecutive failed pings in 15 seconds', async () => {
      const server: Server = {
        id: 'srv-smp-1',
        name: 'Survival SMP',
        subdomain: 'smp',
        state: 'READY',
        restart_count: 0,
        last_restart_at: null,
      } as Server;
      serversDb.set(server.id, server);

      clusterDeployments.set('mc-smp', {
        name: 'mc-smp',
        replicas: 1,
        status: { readyReplicas: 1 },
      });

      mockSlpProbeService.probe.mockResolvedValue({
        ready: false,
        error: 'Deadlock socket timeout',
      });

      // 1st failed ping
      await reconciler.reconcile();
      expect(server.state).toBe('READY');

      // 2nd failed ping
      await reconciler.reconcile();
      expect(server.state).toBe('READY');

      // 3rd failed ping -> deadlock detected -> auto-restart triggered
      await reconciler.reconcile();
      expect(server.state).toBe('STARTING');
      expect(server.restart_count).toBe(1);
      expect(mockK8sService.restartServer).toHaveBeenCalledWith(server);
    });
  });

  describe('Auto-Restart Backoff Policy (RF-ARQ-06 - 3 falhas em 10 min -> CRASHED)', () => {
    it('should auto-restart up to 3 times within 10 minutes and transition to CRASHED on the 4th failure', async () => {
      const server: Server = {
        id: 'srv-smp-1',
        name: 'Survival SMP',
        subdomain: 'smp',
        state: 'READY',
        restart_count: 0,
        last_restart_at: null,
      } as Server;
      serversDb.set(server.id, server);

      const transitions: string[] = [];

      // 1st failure
      await reconciler.handleCrashOrDeadlock(server, transitions);
      expect(server.state).toBe('STARTING');
      expect(server.restart_count).toBe(1);

      // 2nd failure
      await reconciler.handleCrashOrDeadlock(server, transitions);
      expect(server.state).toBe('STARTING');
      expect(server.restart_count).toBe(2);

      // 3rd failure
      await reconciler.handleCrashOrDeadlock(server, transitions);
      expect(server.state).toBe('STARTING');
      expect(server.restart_count).toBe(3);

      // 4th failure within 10 min window -> Exceeded threshold -> CRASHED
      await reconciler.handleCrashOrDeadlock(server, transitions);
      expect(server.state).toBe('CRASHED');
      expect(server.restart_count).toBe(4);
      expect(mockK8sService.stopServer).toHaveBeenCalledWith(server);
      expect(mockGatewayIpcService.broadcastRouteUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: server.id,
          status: 'CRASHED',
        }),
      );
    });

    it('should reset restart_count when server stays stable in READY for > 10 minutes', async () => {
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);
      const server: Server = {
        id: 'srv-smp-1',
        name: 'Survival SMP',
        subdomain: 'smp',
        state: 'READY',
        restart_count: 2,
        last_restart_at: elevenMinutesAgo,
      } as Server;
      serversDb.set(server.id, server);

      clusterDeployments.set('mc-smp', {
        name: 'mc-smp',
        replicas: 1,
        status: { readyReplicas: 1 },
      });

      mockSlpProbeService.probe.mockResolvedValue({
        ready: true,
        version: 'Paper 1.20.4',
        playersOnline: 0,
        maxPlayers: 20,
      });

      await reconciler.reconcile();

      expect(server.restart_count).toBe(0);
      expect(mockServerRepo.save).toHaveBeenCalledWith(server);
    });
  });

  describe('RF-ARQ-07: Inactivity Hibernation (scale-to-zero)', () => {
    it('should hibernate server to STOPPED and scale-to-zero when idle with 0 players exceeds sleep_timeout_minutes', async () => {
      const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000);
      const server: Server = {
        id: 'srv-idle-1',
        name: 'Idle Server',
        subdomain: 'idle',
        state: 'READY',
        sleep_timeout_minutes: 15,
        last_player_active_at: sixteenMinutesAgo,
        auto_wake: true,
      } as Server;
      serversDb.set(server.id, server);

      clusterDeployments.set('mc-idle', {
        name: 'mc-idle',
        replicas: 1,
        status: { readyReplicas: 1 },
      });

      mockSlpProbeService.probe.mockResolvedValue({
        ready: true,
        version: 'Paper 1.20.4',
        playersOnline: 0,
        maxPlayers: 20,
      });

      await reconciler.reconcile();

      expect(server.state).toBe('STOPPED');
      expect(server.last_player_active_at).toBeNull();
      expect(mockK8sService.stopServer).toHaveBeenCalledWith(server);
      expect(mockGatewayIpcService.broadcastRouteUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: 'srv-idle-1',
          status: 'STOPPED',
          auto_wake: true,
        }),
      );
    });

    it('should update last_player_active_at when players are online and not hibernate', async () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const server: Server = {
        id: 'srv-active-1',
        name: 'Active Server',
        subdomain: 'active',
        state: 'READY',
        sleep_timeout_minutes: 15,
        last_player_active_at: tenMinutesAgo,
        auto_wake: true,
      } as Server;
      serversDb.set(server.id, server);

      clusterDeployments.set('mc-active', {
        name: 'mc-active',
        replicas: 1,
        status: { readyReplicas: 1 },
      });

      mockSlpProbeService.probe.mockResolvedValue({
        ready: true,
        version: 'Paper 1.20.4',
        playersOnline: 2,
        maxPlayers: 20,
      });

      const beforeReconcile = Date.now();
      await reconciler.reconcile();

      expect(server.state).toBe('READY');
      expect(server.last_player_active_at!.getTime()).toBeGreaterThanOrEqual(beforeReconcile);
      expect(mockK8sService.stopServer).not.toHaveBeenCalled();
    });

    it('should never hibernate servers configured with sleep_timeout_minutes: 0 (Always-On)', async () => {
      const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000);
      const server: Server = {
        id: 'srv-alwayson-1',
        name: 'Always On Server',
        subdomain: 'alwayson',
        state: 'READY',
        sleep_timeout_minutes: 0,
        last_player_active_at: twoHoursAgo,
        auto_wake: true,
      } as Server;
      serversDb.set(server.id, server);

      clusterDeployments.set('mc-alwayson', {
        name: 'mc-alwayson',
        replicas: 1,
        status: { readyReplicas: 1 },
      });

      mockSlpProbeService.probe.mockResolvedValue({
        ready: true,
        version: 'Paper 1.20.4',
        playersOnline: 0,
        maxPlayers: 20,
      });

      await reconciler.reconcile();

      expect(server.state).toBe('READY');
      expect(mockK8sService.stopServer).not.toHaveBeenCalled();
    });
  });
});
