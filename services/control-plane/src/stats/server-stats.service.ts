import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppConfigService } from '@config/app-config.service';
import { CONSOLE_DRIVER_TOKEN, ConsoleDriver } from '@console/console-driver.interface';
import { Server } from '@database/entities/server.entity';
import { KubernetesService } from '@k8s/k8s.service';

import { ServerActivityBus } from '../server-events/server-activity.bus';
import { ServerStatsDto, StatsSample } from './dto/server-stats.dto';
import { parseTickQuery, parseTpsCommand, TickReading } from './tick-output';

const MAX_WINDOW_MINUTES = 60;
const RCON_TIMEOUT_MS = 5000;
const BYTES_PER_MB = 1024 * 1024;

interface PodContext {
  startedAt: Date | null;
  memoryLimitMb: number | null;
}

/**
 * Keeps the last hour of TPS, MSPT and container memory per running server, in memory.
 * A control plane restart starts the series over, which is fine for a live performance panel.
 */
@Injectable()
export class ServerStatsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ServerStatsService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly samples = new Map<string, StatsSample[]>();
  private readonly pods = new Map<string, PodContext>();

  constructor(
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    private readonly k8s: KubernetesService,
    @Inject(CONSOLE_DRIVER_TOKEN)
    private readonly console: ConsoleDriver,
    private readonly config: AppConfigService,
    @Optional() private readonly activity?: ServerActivityBus,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.isTest) {
      return;
    }
    this.timer = setInterval(() => {
      this.collect().catch((err) => {
        this.logger.error(`Stats collection failed: ${err.message}`, err.stack);
      });
    }, this.config.serverStatsIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async collect(): Promise<void> {
    const running = await this.serverRepo.find({ where: { state: 'READY' } });
    const runningIds = new Set(running.map((s) => s.id));
    for (const id of [...this.samples.keys()]) {
      if (!runningIds.has(id)) {
        this.samples.delete(id);
        this.pods.delete(id);
      }
    }
    await Promise.allSettled(running.map((server) => this.sample(server)));
  }

  async getStats(id: string, window = `${MAX_WINDOW_MINUTES}m`): Promise<ServerStatsDto> {
    const minutes = this.parseWindow(window);
    const server = await this.serverRepo.findOne({ where: { id } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }

    const since = Date.now() - minutes * 60_000;
    const history =
      server.state === 'READY'
        ? (this.samples.get(id) ?? []).filter((s) => Date.parse(s.timestamp) >= since)
        : [];
    const latest = history.at(-1);
    const pod = this.pods.get(id);

    return {
      window,
      tps: latest?.tps ?? null,
      mspt: latest?.mspt ?? null,
      msptP95: latest?.msptP95 ?? null,
      msptP99: latest?.msptP99 ?? null,
      memoryUsedMb: latest?.memoryUsedMb ?? null,
      memoryLimitMb: pod?.memoryLimitMb ?? null,
      heapMb: server.allocated_memory_mb,
      uptimeSeconds: pod?.startedAt
        ? Math.max(0, Math.floor((Date.now() - pod.startedAt.getTime()) / 1000))
        : null,
      history,
    };
  }

  private parseWindow(window: string): number {
    const match = /^(\d{1,2})m$/.exec(window);
    const minutes = match ? Number(match[1]) : 0;
    if (minutes < 1 || minutes > MAX_WINDOW_MINUTES) {
      throw new BadRequestException(`window must be between 1m and ${MAX_WINDOW_MINUTES}m`);
    }
    return minutes;
  }

  private async sample(server: Server): Promise<void> {
    const [tick, pod] = await Promise.all([this.readTick(server), this.readPod(server)]);
    if (tick.tps === null && tick.mspt === null && pod.memoryUsedMb === null) {
      return;
    }

    const cutoff = Date.now() - MAX_WINDOW_MINUTES * 60_000;
    const kept = (this.samples.get(server.id) ?? []).filter(
      (s) => Date.parse(s.timestamp) >= cutoff,
    );
    kept.push({
      timestamp: new Date().toISOString(),
      tps: tick.tps,
      mspt: tick.mspt,
      msptP95: tick.p95,
      msptP99: tick.p99,
      memoryUsedMb: pod.memoryUsedMb,
    });
    this.samples.set(server.id, kept);
    this.activity?.publish(server.id, 'stats');
  }

  /** `tps` exists on Paper and Purpur; `tick query` on vanilla 1.20.3+ and gives MSPT. Either may be missing. */
  private async readTick(server: Server): Promise<Omit<TickReading, 'p50'>> {
    const [tpsOutput, tickOutput] = await Promise.all([
      this.run(server, 'tps'),
      this.run(server, 'tick query'),
    ]);
    const tick = tickOutput
      ? parseTickQuery(tickOutput)
      : { tps: null, mspt: null, p95: null, p99: null };
    return {
      tps: (tpsOutput ? parseTpsCommand(tpsOutput) : null) ?? tick.tps,
      mspt: tick.mspt,
      p95: tick.p95,
      p99: tick.p99,
    };
  }

  private async run(server: Server, command: string): Promise<string | null> {
    try {
      return await this.console.sendCommand(server, command, { timeoutMs: RCON_TIMEOUT_MS });
    } catch (err) {
      this.logger.debug(`"${command}" failed for ${server.subdomain}: ${(err as Error).message}`);
      return null;
    }
  }

  private async readPod(server: Server): Promise<{ memoryUsedMb: number | null }> {
    try {
      const stats = await this.k8s.getServerPodStats(server);
      if (!stats) {
        return { memoryUsedMb: null };
      }
      this.pods.set(server.id, {
        startedAt: stats.startedAt,
        memoryLimitMb:
          stats.memoryLimitBytes === null
            ? null
            : Math.round(stats.memoryLimitBytes / BYTES_PER_MB),
      });
      return {
        memoryUsedMb:
          stats.memoryUsedBytes === null ? null : Math.round(stats.memoryUsedBytes / BYTES_PER_MB),
      };
    } catch (err) {
      this.logger.debug(`Pod stats failed for ${server.subdomain}: ${(err as Error).message}`);
      return { memoryUsedMb: null };
    }
  }
}
