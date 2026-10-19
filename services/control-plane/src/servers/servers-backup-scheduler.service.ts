import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';

import { AppConfigService } from '@config/app-config.service';
import { BackupStatus, ServerBackupEntity } from '@database/entities/server-backup.entity';
import { BackupScheduleMode, Server } from '@database/entities/server.entity';
import { ServersBackupService } from './servers-backup.service';

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function getLocalParts(date: Date, timeZone: string): LocalParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function isInsideWindow(minutes: number, startMin: number, endMin: number): boolean {
  if (startMin <= endMin) {
    return minutes >= startMin && minutes <= endMin;
  }
  return minutes >= startMin || minutes <= endMin;
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guessUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(dtf.formatToParts(guessUtc).map((p) => [p.type, p.value]));
  const formattedInTzAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const diff = guessUtc.getTime() - formattedInTzAsUtc;
  return new Date(guessUtc.getTime() + diff);
}

export function adjustToWindow(
  date: Date,
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined,
  timeZone: string,
): Date {
  if (!windowStart || !windowEnd) {
    return date;
  }
  const startMin = timeToMinutes(windowStart);
  const endMin = timeToMinutes(windowEnd);
  const local = getLocalParts(date, timeZone);
  const currentMin = local.hour * 60 + local.minute;

  if (isInsideWindow(currentMin, startMin, endMin)) {
    return date;
  }

  if (startMin <= endMin) {
    if (currentMin < startMin) {
      return zonedTimeToUtc(
        local.year,
        local.month,
        local.day,
        Math.floor(startMin / 60),
        startMin % 60,
        timeZone,
      );
    }
    const tomorrow = new Date(date.getTime() + 24 * 3600 * 1000);
    const tomLocal = getLocalParts(tomorrow, timeZone);
    return zonedTimeToUtc(
      tomLocal.year,
      tomLocal.month,
      tomLocal.day,
      Math.floor(startMin / 60),
      startMin % 60,
      timeZone,
    );
  }

  return zonedTimeToUtc(
    local.year,
    local.month,
    local.day,
    Math.floor(startMin / 60),
    startMin % 60,
    timeZone,
  );
}

export function calculateNextRun(
  server: {
    backup_schedule_mode?: BackupScheduleMode | string | null;
    backup_interval_hours?: number | null;
    backup_daily_time?: string | null;
    backup_window_start?: string | null;
    backup_window_end?: string | null;
    backup_timezone?: string | null;
  },
  fromDate: Date = new Date(),
): Date | null {
  const mode = server.backup_schedule_mode;
  if (!mode || mode === 'OFF') {
    return null;
  }

  const timeZone = server.backup_timezone || 'America/Sao_Paulo';

  if (mode === 'INTERVAL') {
    const hours =
      server.backup_interval_hours && server.backup_interval_hours > 0
        ? server.backup_interval_hours
        : 12;
    const candidate = new Date(fromDate.getTime() + hours * 3600 * 1000);
    return adjustToWindow(
      candidate,
      server.backup_window_start,
      server.backup_window_end,
      timeZone,
    );
  }

  if (mode === 'DAILY') {
    const dailyTime = server.backup_daily_time || '04:00';
    const [targetHour, targetMinute] = dailyTime.split(':').map(Number);

    const local = getLocalParts(fromDate, timeZone);
    let candidate = zonedTimeToUtc(
      local.year,
      local.month,
      local.day,
      targetHour,
      targetMinute,
      timeZone,
    );

    if (candidate.getTime() <= fromDate.getTime()) {
      const tomorrow = new Date(fromDate.getTime() + 24 * 3600 * 1000);
      const tomLocal = getLocalParts(tomorrow, timeZone);
      candidate = zonedTimeToUtc(
        tomLocal.year,
        tomLocal.month,
        tomLocal.day,
        targetHour,
        targetMinute,
        timeZone,
      );
    }
    return adjustToWindow(
      candidate,
      server.backup_window_start,
      server.backup_window_end,
      timeZone,
    );
  }

  return null;
}

@Injectable()
export class ServersBackupSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ServersBackupSchedulerService.name);
  private intervalTimer: NodeJS.Timeout | null = null;
  private isTicking = false;

  constructor(
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    @InjectRepository(ServerBackupEntity)
    private readonly backupRepo: Repository<ServerBackupEntity>,
    private readonly backupService: ServersBackupService,
    private readonly configService: AppConfigService,
  ) {}

  onApplicationBootstrap() {
    if (!this.configService.isTest) {
      this.intervalTimer = setInterval(() => {
        this.runScheduledTick().catch((err) => {
          this.logger.error(
            `Erro durante ciclo de agendamento de backups: ${err.message}`,
            err.stack,
          );
        });
      }, 60_000);
      this.intervalTimer.unref();
    }
  }

  onModuleDestroy() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  calculateNextRun(server: Partial<Server>, fromDate: Date = new Date()): Date | null {
    return calculateNextRun(server, fromDate);
  }

  async runScheduledTick(now: Date = new Date()): Promise<void> {
    if (this.isTicking) {
      return;
    }
    this.isTicking = true;
    try {
      const dueServers = await this.serverRepo.find({
        where: {
          backup_next_run_at: LessThanOrEqual(now),
        },
      });

      for (const server of dueServers) {
        if (server.backup_schedule_mode !== 'INTERVAL' && server.backup_schedule_mode !== 'DAILY') {
          server.backup_next_run_at = null;
          await this.serverRepo.save(server);
          continue;
        }

        const tz = server.backup_timezone || 'America/Sao_Paulo';
        if (server.backup_window_start && server.backup_window_end) {
          const startMin = timeToMinutes(server.backup_window_start);
          const endMin = timeToMinutes(server.backup_window_end);
          const localNow = getLocalParts(now, tz);
          const currentMin = localNow.hour * 60 + localNow.minute;
          if (!isInsideWindow(currentMin, startMin, endMin)) {
            // Fora da janela: adia para o próximo início de janela
            server.backup_next_run_at = adjustToWindow(
              now,
              server.backup_window_start,
              server.backup_window_end,
              tz,
            );
            await this.serverRepo.save(server);
            continue;
          }
        }

        if (server.state === 'READY') {
          try {
            await this.backupService.createBackup(server, 'HOT');
          } catch (err: any) {
            this.logger.error(
              `Backup agendado HOT falhou para o servidor ${server.subdomain}: ${err.message}`,
            );
          } finally {
            server.backup_next_run_at = this.calculateNextRun(server, now);
            await this.serverRepo.save(server);
          }
        } else if (server.state === 'STOPPED') {
          const lastBackup = await this.backupRepo.findOne({
            where: { serverId: server.id, status: BackupStatus.COMPLETED },
            order: { createdAt: 'DESC' },
          });

          const shouldSkip =
            lastBackup &&
            (!server.last_player_active_at ||
              server.last_player_active_at.getTime() <= lastBackup.createdAt.getTime());

          if (shouldSkip) {
            this.logger.log(
              `Pulando backup COLD agendado para o servidor ${server.subdomain}: sem jogadores desde o último backup.`,
            );
            server.backup_next_run_at = this.calculateNextRun(server, now);
            await this.serverRepo.save(server);
          } else {
            try {
              await this.backupService.createBackup(server, 'COLD');
            } catch (err: any) {
              this.logger.error(
                `Backup agendado COLD falhou para o servidor ${server.subdomain}: ${err.message}`,
              );
            } finally {
              server.backup_next_run_at = this.calculateNextRun(server, now);
              await this.serverRepo.save(server);
            }
          }
        }
        // Para outros estados (STARTING, UPDATING, STOPPING, etc.): não altera backup_next_run_at
      }
    } finally {
      this.isTicking = false;
    }
  }
}
