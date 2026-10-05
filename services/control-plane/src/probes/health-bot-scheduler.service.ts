import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Server } from '@database/entities/server.entity';
import { AppConfigService } from '@config/app-config.service';

import { HealthBotProbeService, HealthBotReport } from './health-bot-probe.service';

export interface HealthBotServerOverview {
  serverId: string;
  subdomain: string;
  state: string;
  totalChecks: number;
  successfulChecks: number;
  uptimePercentage: number;
  avgTotalDurationMs: number;
  latestReport?: HealthBotReport;
}

export interface HealthBotOverview {
  totalMonitoredServers: number;
  healthyServers: number;
  unhealthyServers: number;
  servers: Record<string, HealthBotServerOverview>;
}

@Injectable()
export class HealthBotSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HealthBotSchedulerService.name);
  private intervalTimer: NodeJS.Timeout | null = null;
  private readonly maxReportsPerServer = 50;

  // In-memory circular buffer of reports per serverId
  private readonly reportsMap = new Map<string, HealthBotReport[]>();

  constructor(
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    private readonly probeService: HealthBotProbeService,
    private readonly configService: AppConfigService,
  ) {}

  onApplicationBootstrap() {
    const config = this.configService.healthBot;
    if (config?.enabled && !this.configService.isTest) {
      this.logger.log(`Starting Health Bot periodic scheduler (interval: ${config.intervalMs}ms)`);
      this.intervalTimer = setInterval(() => {
        this.runScheduledProbes().catch((err) => {
          this.logger.error(`Error during scheduled health bot cycle: ${err.message}`, err.stack);
        });
      }, config.intervalMs);
    }
  }

  onModuleDestroy() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  /**
   * Helper to resolve the internal cluster DNS host for a server.
   */
  getProbeHost(server: Server): string {
    // Same rule as RconConnectionPool: with the mock driver the game server runs on this host.
    if (this.configService.isTest || this.configService.kubernetes.useMockDriver) {
      return '127.0.0.1';
    }
    return `mc-${server.subdomain}.${this.configService.kubernetes.namespace}.svc.cluster.local`;
  }

  /**
   * Probes an individual server on-demand and appends the result to the circular buffer.
   */
  async probeServer(serverId: string): Promise<HealthBotReport> {
    const server = await this.serverRepo.findOne({ where: { id: serverId } });
    if (!server) {
      throw new Error(`Server with ID ${serverId} not found`);
    }

    const host = this.getProbeHost(server);
    const port = server.allocated_port ?? 25565;

    const report = await this.probeService.probe({
      serverId: server.id,
      subdomain: server.subdomain,
      host,
      port,
      timeoutMs: this.configService.healthBot?.timeoutMs,
    });

    this.storeReport(serverId, report);
    return report;
  }

  /**
   * Runs the health bot probe against all active (READY) Minecraft servers.
   */
  async runScheduledProbes(): Promise<HealthBotReport[]> {
    const activeServers = await this.serverRepo.find({
      where: { state: 'READY' },
    });

    const results: HealthBotReport[] = [];

    for (const server of activeServers) {
      const isMinecraft = !server.game_type || server.game_type.toLowerCase() === 'minecraft';
      if (!isMinecraft) {
        continue;
      }

      try {
        const report = await this.probeServer(server.id);
        results.push(report);
      } catch (err: any) {
        this.logger.warn(
          `Failed to execute health bot probe for ${server.subdomain}: ${err.message}`,
        );
      }
    }

    return results;
  }

  /**
   * Retrieves the historical reports for a server from memory, ordered from newest to oldest.
   */
  getReports(serverId: string, limit: number = 20): HealthBotReport[] {
    const list = this.reportsMap.get(serverId) || [];
    return list.slice(0, Math.min(limit, this.maxReportsPerServer));
  }

  /**
   * Retrieves the latest report for a given server.
   */
  getLatestReport(serverId: string): HealthBotReport | undefined {
    const list = this.reportsMap.get(serverId);
    return list && list.length > 0 ? list[0] : undefined;
  }

  /**
   * Generates a global overview of health bot status across all monitored servers.
   */
  async getOverview(): Promise<HealthBotOverview> {
    const servers = await this.serverRepo.find();
    const serverOverviews: Record<string, HealthBotServerOverview> = {};

    let healthyCount = 0;
    let unhealthyCount = 0;

    for (const server of servers) {
      const reports = this.reportsMap.get(server.id) || [];
      const totalChecks = reports.length;
      const successfulChecks = reports.filter((r) => r.healthy).length;
      const uptimePercentage =
        totalChecks > 0 ? Math.round((successfulChecks / totalChecks) * 1000) / 10 : 100;

      const totalDurationSum = reports.reduce((acc, r) => acc + r.latencies.totalDurationMs, 0);
      const avgTotalDurationMs = totalChecks > 0 ? Math.round(totalDurationSum / totalChecks) : 0;

      const latestReport = reports[0];

      if (latestReport) {
        if (latestReport.healthy) {
          healthyCount++;
        } else {
          unhealthyCount++;
        }
      }

      serverOverviews[server.id] = {
        serverId: server.id,
        subdomain: server.subdomain,
        state: server.state,
        totalChecks,
        successfulChecks,
        uptimePercentage,
        avgTotalDurationMs,
        latestReport,
      };
    }

    return {
      totalMonitoredServers: servers.length,
      healthyServers: healthyCount,
      unhealthyServers: unhealthyCount,
      servers: serverOverviews,
    };
  }

  /**
   * Stores a report in the in-memory circular buffer (max 50 items per server).
   */
  storeReport(serverId: string, report: HealthBotReport) {
    const existing = this.reportsMap.get(serverId) || [];
    existing.unshift(report);
    if (existing.length > this.maxReportsPerServer) {
      existing.pop();
    }
    this.reportsMap.set(serverId, existing);
  }

  /**
   * Clears the in-memory reports (useful for testing or cache reset).
   */
  clearReports(serverId?: string) {
    if (serverId) {
      this.reportsMap.delete(serverId);
    } else {
      this.reportsMap.clear();
    }
  }
}
