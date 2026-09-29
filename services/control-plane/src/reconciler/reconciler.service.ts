import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppConfigService } from '@config/app-config.service';
import { Server } from '@database/entities/server.entity';
import { KubernetesService } from '@k8s/k8s.service';

export interface ReconciliationSummary {
  checked: number;
  healedDeployments: string[];
  reconciledReplicas: string[];
  stateTransitions: string[];
  durationMs: number;
  timestamp: Date;
}

@Injectable()
export class ReconcilerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReconcilerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isReconciling = false;
  private lastSummary: ReconciliationSummary | null = null;

  constructor(
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    private readonly k8sService: KubernetesService,
    private readonly configService: AppConfigService,
  ) {}

  onApplicationBootstrap() {
    if (!this.configService.isTest && process.env.ENABLE_RECONCILER !== 'false') {
      const intervalMs = this.configService.reconciliationIntervalMs;
      this.logger.log(`Starting background reconciliation loop (interval: ${intervalMs}ms)...`);
      this.timer = setInterval(() => this.reconcileSafe(), intervalMs);
    }
  }

  onApplicationShutdown() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('Stopped background reconciliation loop.');
    }
  }

  private async reconcileSafe(): Promise<void> {
    try {
      await this.reconcile();
    } catch (err: any) {
      this.logger.error(`Error during reconciliation cycle: ${err.message}`, err.stack);
    }
  }

  /**
   * Performs a single synchronization and self-healing cycle between the PostgreSQL
   * server registry and the active Kubernetes deployments.
   * RF-ARQ-25: Desired vs Observed State.
   * Acceptance Criterion: If a deployment was deleted manually from the cluster,
   * it is automatically restored in the next cycle.
   */
  async reconcile(): Promise<ReconciliationSummary> {
    if (this.isReconciling) {
      this.logger.debug('Reconciliation cycle already in progress, skipping tick.');
      return (
        this.lastSummary || {
          checked: 0,
          healedDeployments: [],
          reconciledReplicas: [],
          stateTransitions: [],
          durationMs: 0,
          timestamp: new Date(),
        }
      );
    }

    this.isReconciling = true;
    const startTime = Date.now();

    const healedDeployments: string[] = [];
    const reconciledReplicas: string[] = [];
    const stateTransitions: string[] = [];

    try {
      const servers = await this.serverRepo.find({
        relations: ['minecraft_settings'],
      });

      let deployments: any[] = [];
      try {
        deployments = await this.k8sService.listDeployments();
      } catch (err: any) {
        this.logger.error(`Failed to list Kubernetes deployments: ${err.message}`);
        throw err;
      }

      const deploymentMap = new Map(deployments.map((d) => [d.name, d]));

      for (const server of servers) {
        // Skip servers in transient or terminal failure states unless they are active
        if (server.state === 'CRASHED' || server.state === 'FAILED') {
          continue;
        }

        const depName = `mc-${server.subdomain}`;
        const observedDep = deploymentMap.get(depName);

        // 1. Auto-healing: If deployment does not exist in cluster, reprovision it
        if (!observedDep) {
          this.logger.warn(
            `Deployment "${depName}" is missing from cluster for server "${server.name}". Auto-healing (RF-ARQ-25)...`,
          );
          try {
            await this.k8sService.provisionServer(server, server.minecraft_settings);
            healedDeployments.push(depName);
          } catch (err: any) {
            this.logger.error(`Failed to auto-heal deployment "${depName}": ${err.message}`);
          }
          continue;
        }

        // 2. Replica synchronization: Desired vs Observed
        const desiredReplicas =
          server.state === 'READY' || server.state === 'STARTING' ? 1 : 0;

        if (observedDep.replicas !== desiredReplicas) {
          this.logger.warn(
            `Replica drift for "${depName}": cluster=${observedDep.replicas}, desired=${desiredReplicas}. Reconciling...`,
          );
          try {
            if (desiredReplicas === 1) {
              await this.k8sService.startServer(server);
            } else {
              await this.k8sService.stopServer(server);
            }
            reconciledReplicas.push(depName);
          } catch (err: any) {
            this.logger.error(`Failed to reconcile replicas for "${depName}": ${err.message}`);
          }
        }

        // 3. Observed status update: If pod is ready in Kubernetes, transition STARTING -> READY
        const readyCount = observedDep.status?.readyReplicas ?? 0;
        if (server.state === 'STARTING' && readyCount >= 1) {
          this.logger.log(`Server [${server.subdomain}] pod is ready. Updating state STARTING -> READY.`);
          server.state = 'READY';
          await this.serverRepo.save(server);
          stateTransitions.push(`${server.subdomain}: STARTING -> READY`);
        } else if (
          server.state === 'STOPPING' &&
          observedDep.replicas === 0 &&
          readyCount === 0
        ) {
          this.logger.log(`Server [${server.subdomain}] pod stopped. Updating state STOPPING -> READY.`);
          server.state = 'STOPPED';
          await this.serverRepo.save(server);
          stateTransitions.push(`${server.subdomain}: STOPPING -> STOPPED`);
        }
      }

      const durationMs = Date.now() - startTime;
      const summary: ReconciliationSummary = {
        checked: servers.length,
        healedDeployments,
        reconciledReplicas,
        stateTransitions,
        durationMs,
        timestamp: new Date(),
      };

      this.lastSummary = summary;
      if (healedDeployments.length > 0 || reconciledReplicas.length > 0 || stateTransitions.length > 0) {
        this.logger.log(
          `Reconciliation completed in ${durationMs}ms: ` +
            `healed=${healedDeployments.length}, ` +
            `reconciledReplicas=${reconciledReplicas.length}, ` +
            `stateTransitions=${stateTransitions.length}`,
        );
      }

      return summary;
    } finally {
      this.isReconciling = false;
    }
  }

  getLastSummary(): ReconciliationSummary | null {
    return this.lastSummary;
  }
}
