import { promises as fs } from 'node:fs';
import os from 'node:os';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppConfigService } from '@config/app-config.service';
import { Server, ServerState } from '@database/entities/server.entity';
import { TailscaleDevice } from '@database/entities/tailscale-device.entity';

import { classifyDiskUsage } from './disk-thresholds';
import { DiskMetricsDto, NodeMetricsDto } from './dto/node-metrics.dto';

const BYTES_PER_MB = 1024 * 1024;
const MIN_CPU_WINDOW_MS = 1000;
const MEMORY_HOLDING_STATES: ServerState[] = ['STARTING', 'READY', 'STOPPING', 'UPDATING'];

interface CpuSample {
  at: number;
  busy: number;
  total: number;
}

@Injectable()
export class NodeMetricsService {
  private readonly logger = new Logger(NodeMetricsService.name);
  private cpuSample = this.sampleCpu();
  private cpuUsedPercent = 0;

  constructor(
    private readonly config: AppConfigService,
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    @InjectRepository(TailscaleDevice)
    private readonly deviceRepo: Repository<TailscaleDevice>,
  ) {}

  async getMetrics(): Promise<NodeMetricsDto> {
    const [disk, allocated, active] = await Promise.all([
      this.readDisk(),
      this.allocatedMemoryBytes(),
      this.deviceRepo.count({ where: { status: 'ACTIVE' } }),
    ]);

    return {
      cpu: { usedPercent: this.readCpuPercent(), cores: os.cpus().length },
      memory: { total: os.totalmem(), allocated },
      disk,
      tailnet: { active, limit: this.config.tailscale.deviceLimit },
    };
  }

  /** SRS 05 §1.1: at 85 % of the host disk no new instance is created. */
  async assertDiskAllowsCreation(): Promise<void> {
    let disk: DiskMetricsDto;
    try {
      disk = await this.readDisk();
    } catch (err: any) {
      this.logger.warn(`Could not read disk usage, creation not blocked: ${err.message}`);
      return;
    }
    if (disk.blocksCreation) {
      throw new HttpException(
        {
          code: 'DISK_USAGE_BLOCKED',
          message: `Host disk is ${disk.usedPercent}% full; creating servers is blocked until space is freed`,
        },
        507,
      );
    }
  }

  private async readDisk(): Promise<DiskMetricsDto> {
    const stat = await fs.statfs(this.config.storage.serversDataRoot);
    const total = stat.blocks * stat.bsize;
    const free = stat.bavail * stat.bsize;
    const usedPercent = total > 0 ? Math.round((1 - free / total) * 1000) / 10 : 0;
    return { total, free, usedPercent, ...classifyDiskUsage(usedPercent) };
  }

  private async allocatedMemoryBytes(): Promise<number> {
    const servers = await this.serverRepo.find();
    return servers
      .filter((server) => MEMORY_HOLDING_STATES.includes(server.state))
      .reduce((sum, server) => sum + server.allocated_memory_mb * BYTES_PER_MB, 0);
  }

  /** os.cpus() counts ticks since boot, so usage is the delta between samples; calls inside the window reuse the last value. */
  private readCpuPercent(): number {
    const now = this.sampleCpu();
    const elapsed = now.at - this.cpuSample.at;
    const ticks = now.total - this.cpuSample.total;
    if (elapsed >= MIN_CPU_WINDOW_MS && ticks > 0) {
      this.cpuUsedPercent = Math.round(((now.busy - this.cpuSample.busy) / ticks) * 100);
      this.cpuSample = now;
    }
    return this.cpuUsedPercent;
  }

  private sampleCpu(): CpuSample {
    let busy = 0;
    let total = 0;
    for (const { times } of os.cpus()) {
      const all = times.user + times.nice + times.sys + times.idle + times.irq;
      total += all;
      busy += all - times.idle;
    }
    return { at: Date.now(), busy, total };
  }
}
