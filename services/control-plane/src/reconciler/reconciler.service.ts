import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppConfigService } from '@config/app-config.service';
import { Server, ServerState } from '@database/entities/server.entity';
import { KubernetesService } from '@k8s/k8s.service';
import { MinecraftSlpProbeService } from '../probes/minecraft-slp-probe.service';
import { GenericTcpProbeService } from '../probes/generic-tcp-probe.service';
import { ProbeResult } from '../probes/probe-provider.interface';
import { GatewayIpcService } from '../gateway-ipc/gateway-ipc.service';
import { RouteAction } from '../gateway-ipc/gateway-ipc.interfaces';

export interface ReconciliationSummary {
  checked: number;
  healedDeployments: string[];
  reconciledReplicas: string[];
  stateTransitions: string[];
  durationMs: number;
  timestamp: Date;
}

interface LivenessFailureTracker {
  count: number;
  firstFailureAt: number;
}

@Injectable()
export class ReconcilerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReconcilerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isReconciling = false;
  private lastSummary: ReconciliationSummary | null = null;

  // Track consecutive liveness failures within 15-second windows (RF-ARQ-05)
  private readonly livenessFailures = new Map<string, LivenessFailureTracker>();

  constructor(
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    private readonly k8sService: KubernetesService,
    private readonly configService: AppConfigService,
    private readonly slpProbeService: MinecraftSlpProbeService,
    private readonly genericTcpProbeService: GenericTcpProbeService,
    @Optional()
    private readonly gatewayIpcService?: GatewayIpcService,
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
   * Helper to execute the probe for a server using its dedicated game provider (RF-MG-06, C-14).
   */
  async probeServer(server: Server): Promise<ProbeResult> {
    const isMinecraft = !server.game_type || server.game_type.toLowerCase() === 'minecraft';
    const provider = isMinecraft ? this.slpProbeService : this.genericTcpProbeService;
    const host = this.getProbeHost(server);
    const port = server.allocated_port || 25565;
    return provider.probe(host, port, 3000);
  }

  getProbeHost(server: Server): string {
    if (this.configService.isTest) {
      return '127.0.0.1';
    }
    return `mc-${server.subdomain}.${this.configService.kubernetes.namespace}.svc.cluster.local`;
  }

  /**
   * Performs a single synchronization, probe check, self-healing, and auto-restart cycle
   * between the PostgreSQL server registry and Kubernetes deployments (RF-ARQ-01..06, RF-ARQ-25).
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
        // Skip terminal failure states
        if (server.state === 'CRASHED' || server.state === 'FAILED') {
          continue;
        }

        const depName = `mc-${server.subdomain}`;
        const observedDep = deploymentMap.get(depName);

        // 1. Auto-healing: If deployment is missing from cluster, reprovision it (RF-ARQ-25)
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

        const readyCount = observedDep.status?.readyReplicas ?? 0;

        // 3. STARTING -> READY: requires K8s readyReplicas >= 1 AND successful SLP probe (C-14 / RF-ARQ-04)
        if (server.state === 'STARTING') {
          if (readyCount >= 1) {
            const probeResult = await this.probeServer(server);
            if (probeResult.ready) {
              this.logger.log(
                `Server [${server.subdomain}] passed SLP probe (version: ${probeResult.version}). STARTING -> READY.`,
              );
              server.state = 'READY';
              server.restart_count = 0;
              await this.serverRepo.save(server);
              this.notifyGateway(server, 'READY');
              stateTransitions.push(`${server.subdomain}: STARTING -> READY`);
              this.livenessFailures.delete(server.id);
            } else {
              this.logger.debug(
                `Server [${server.subdomain}] pod is ready in K8s, but SLP probe not yet ready: ${probeResult.error}`,
              );
            }
          } else {
            // Check startup probe timeout (RF-ARQ-03, C-09)
            const isModpack = ['FORGE', 'NEOFORGE', 'FABRIC'].includes(
              server.server_type?.toUpperCase(),
            );
            const maxStartupTimeoutMs = isModpack ? 15.5 * 60 * 1000 : 3.5 * 60 * 1000;
            const elapsed = Date.now() - (server.updated_at ? server.updated_at.getTime() : Date.now());

            if (elapsed > maxStartupTimeoutMs) {
              this.logger.error(
                `Server [${server.subdomain}] exceeded max startup timeout (${maxStartupTimeoutMs / 1000}s). Triggering auto-restart.`,
              );
              await this.handleCrashOrDeadlock(server, stateTransitions);
            }
          }
        } else if (server.state === 'READY') {
          // 4. Liveness & Watchdog Probe (RF-ARQ-05: 3 failed pings in 15s = deadlock)
          const probeResult = await this.probeServer(server);
          if (probeResult.ready) {
            this.livenessFailures.delete(server.id);

            // Auto-reset restart_count if server has been stable in READY for > 10 min
            if (server.restart_count > 0 && server.last_restart_at) {
              const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
              if (server.last_restart_at < tenMinutesAgo) {
                this.logger.log(
                  `Server [${server.subdomain}] stable in READY for > 10 min. Resetting restart_count to 0.`,
                );
                server.restart_count = 0;
                await this.serverRepo.save(server);
              }
            }

            // 5. Inactivity Sleep / Hibernation Check (RF-ARQ-07)
            await this.checkInactivityHibernation(server, probeResult.playersOnline, stateTransitions);
          } else {
            const now = Date.now();
            let tracker = this.livenessFailures.get(server.id);
            if (!tracker || now - tracker.firstFailureAt > 15000) {
              tracker = { count: 1, firstFailureAt: now };
              this.livenessFailures.set(server.id, tracker);
              this.logger.warn(
                `Server [${server.subdomain}] liveness probe failed (1/3 in 15s): ${probeResult.error}`,
              );
            } else {
              tracker.count++;
              this.logger.warn(
                `Server [${server.subdomain}] liveness probe failed (${tracker.count}/3 in 15s): ${probeResult.error}`,
              );

              if (tracker.count >= 3) {
                this.logger.error(
                  `Server [${server.subdomain}] JVM deadlock detected (3 failed pings in 15s, RF-ARQ-05).`,
                );
                this.livenessFailures.delete(server.id);
                await this.handleCrashOrDeadlock(server, stateTransitions);
              }
            }
          }
        } else if (
          server.state === 'STOPPING' &&
          observedDep.replicas === 0 &&
          readyCount === 0
        ) {
          this.logger.log(`Server [${server.subdomain}] pod stopped. Updating state STOPPING -> STOPPED.`);
          server.state = 'STOPPED';
          await this.serverRepo.save(server);
          this.notifyGateway(server, 'STOPPED');
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

  /**
   * Applies the auto-restart backoff policy (RF-ARQ-06):
   * Up to 3 attempts within a 10-minute window before marking as CRASHED (Acceptance criterion).
   */
  async handleCrashOrDeadlock(server: Server, stateTransitions?: string[]): Promise<void> {
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

    const withinWindow = server.last_restart_at && server.last_restart_at >= tenMinutesAgo;
    const currentAttempts = withinWindow ? server.restart_count + 1 : 1;

    if (currentAttempts > 3) {
      this.logger.error(
        `Server [${server.subdomain}] exceeded max restart attempts (3 failures in 10 min). Transitioning to CRASHED.`,
      );
      server.state = 'CRASHED';
      server.restart_count = currentAttempts;
      server.last_restart_at = now;
      await this.serverRepo.save(server);
      await this.k8sService.stopServer(server);
      this.notifyGateway(server, 'CRASHED');
      if (stateTransitions) {
        stateTransitions.push(`${server.subdomain}: -> CRASHED`);
      }
      return;
    }

    this.logger.warn(
      `Server [${server.subdomain}] restarting (attempt ${currentAttempts}/3 within 10 min window)...`,
    );
    server.state = 'STARTING';
    server.restart_count = currentAttempts;
    server.last_restart_at = now;
    await this.serverRepo.save(server);
    await this.k8sService.restartServer(server);
    this.notifyGateway(server, 'STARTING');
    if (stateTransitions) {
      stateTransitions.push(`${server.subdomain}: -> STARTING (restart ${currentAttempts}/3)`);
    }
  }

  /**
   * Evaluates player inactivity and triggers hibernation scale-to-zero (RF-ARQ-07).
   */
  async checkInactivityHibernation(
    server: Server,
    playersOnline: number | undefined,
    stateTransitions?: string[],
  ): Promise<void> {
    const online = playersOnline ?? 0;

    if (online > 0) {
      server.last_player_active_at = new Date();
      await this.serverRepo.save(server);
      return;
    }

    const timeoutMinutes = server.sleep_timeout_minutes;
    // sleep_timeout_minutes <= 0 or null indicates 'never' / Always-On
    if (!timeoutMinutes || timeoutMinutes <= 0) {
      return;
    }

    const now = new Date();
    if (!server.last_player_active_at) {
      server.last_player_active_at = server.updated_at || now;
      await this.serverRepo.save(server);
      return;
    }

    const idleMs = now.getTime() - server.last_player_active_at.getTime();
    const timeoutMs = timeoutMinutes * 60 * 1000;

    if (idleMs >= timeoutMs) {
      this.logger.log(
        `Server [${server.subdomain}] idle with 0 players for ${Math.round(idleMs / 60000)}m (timeout: ${timeoutMinutes}m). Initiating hibernation scale-to-zero (RF-ARQ-07)...`,
      );
      server.state = 'STOPPED';
      server.last_player_active_at = null;
      await this.serverRepo.save(server);
      await this.k8sService.stopServer(server);
      this.notifyGateway(server, 'STOPPED');
      if (stateTransitions) {
        stateTransitions.push(`${server.subdomain}: READY -> STOPPED (idle hibernation)`);
      }
    }
  }

  private notifyGateway(server: Server, status: ServerState): void {
    if (!this.gatewayIpcService) {
      return;
    }

    try {
      this.gatewayIpcService.broadcastRouteUpdate({
        action: RouteAction.STATUS_CHANGE,
        server_id: server.id,
        subdomain: server.subdomain,
        target_ip_port: `${this.getProbeHost(server)}:${server.allocated_port || 25565}`,
        status: status.toUpperCase(),
        access_policy: (server as any).access_policy || 'PUBLIC',
        allowed_group_ids: [],
        allowed_user_ids: [],
        proxy_protocol: Boolean((server.minecraft_settings as any)?.proxy_protocol),
        game_type: server.game_type || 'MINECRAFT',
        routing_model: server.routing_model || 'VirtualHost',
        listen_port: server.allocated_port || 25565,
        auto_wake: server.auto_wake !== false,
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to broadcast route update to Gateway for server ${server.subdomain}: ${err.message}`,
      );
    }
  }

  getLastSummary(): ReconciliationSummary | null {
    return this.lastSummary;
  }
}
