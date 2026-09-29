import { Server } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { ReconcilerService } from './reconciler.service';

describe('ReconcilerService (RF-ARQ-25 - Desired vs Observed State Loop)', () => {
  let reconciler: ReconcilerService;
  let mockServerRepo: any;
  let mockK8sService: any;
  let mockConfigService: any;

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
    };

    mockConfigService = {
      isTest: true,
      reconciliationIntervalMs: 30000,
    };

    reconciler = new ReconcilerService(
      mockServerRepo,
      mockK8sService,
      mockConfigService,
    );
  });

  describe('Acceptance Criterion: Apagar um Deployment à mão é corrigido no próximo ciclo', () => {
    it('should detect manually deleted deployment and auto-heal by reprovisioning it', async () => {
      const server: Server = {
        id: 'srv-smp-1',
        name: 'Survival SMP',
        subdomain: 'smp',
        state: 'READY',
        minecraft_settings: { motd: 'Auto heal test' } as MinecraftServerSettings,
      } as Server;
      serversDb.set(server.id, server);

      // Deployment is NOT in cluster (was manually deleted via `kubectl delete deployment mc-smp`)
      expect(clusterDeployments.has('mc-smp')).toBe(false);

      const summary = await reconciler.reconcile();

      expect(summary.checked).toBe(1);
      expect(summary.healedDeployments).toContain('mc-smp');
      expect(mockK8sService.provisionServer).toHaveBeenCalledWith(server, server.minecraft_settings);
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
      } as Server;
      serversDb.set(server.id, server);

      // Deployment exists in cluster but someone scaled it down to 0
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

  describe('Observed status promotion', () => {
    it('should promote server from STARTING to READY when cluster pod becomes ready', async () => {
      const server: Server = {
        id: 'srv-smp-1',
        name: 'Survival SMP',
        subdomain: 'smp',
        state: 'STARTING',
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
      expect(mockServerRepo.save).toHaveBeenCalledWith(server);
    });
  });

  describe('Healthy state', () => {
    it('should do nothing when desired and observed state match', async () => {
      const server: Server = {
        id: 'srv-smp-1',
        name: 'Survival SMP',
        subdomain: 'smp',
        state: 'READY',
      } as Server;
      serversDb.set(server.id, server);

      clusterDeployments.set('mc-smp', {
        name: 'mc-smp',
        replicas: 1,
        status: { readyReplicas: 1 },
      });

      const summary = await reconciler.reconcile();

      expect(summary.healedDeployments).toHaveLength(0);
      expect(summary.reconciledReplicas).toHaveLength(0);
      expect(summary.stateTransitions).toHaveLength(0);
    });
  });
});
