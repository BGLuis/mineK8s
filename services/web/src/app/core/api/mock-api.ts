import { Injectable } from '@angular/core';
import { Observable, delay, map, of, take, timer } from 'rxjs';

import {
  ServerSettingsPatch,
  DiskAlert,
  NodeMetrics,
  ServerPlayers,
  ServerRuntimeStats,
  TaskProgress,
} from './models';

const LATENCY_MS = 250;

/**
 * Fake data for features the backend does not implement (design report §2.6).
 * Every consumer must render `mc-no-api-tag` next to what comes from here.
 */
@Injectable({ providedIn: 'root' })
export class MockApi {
  /** MISSING: GET /api/node/metrics (CPU, RAM and NVMe of the host). */
  nodeMetrics(): Observable<NodeMetrics> {
    return of<NodeMetrics>({
      cpuPercent: 42,
      cpuLabel: '3,1 de 7,4 GHz',
      ramPercent: 78,
      ramLabel: '24,9 de 32 GiB',
      nvmePercent: 63,
      nvmeLabel: '315 de 500 GB',
      tailnetDevices: { used: 12, limit: 50 },
    }).pipe(delay(LATENCY_MS));
  }

  /** MISSING: GET /api/node/disk-alerts (75/85/90 % thresholds, SRS 05-STORAGE-MODPACKS-BACKUPS). */
  diskAlerts(): Observable<DiskAlert[]> {
    return this.nodeMetrics().pipe(
      map(({ nvmePercent }) => {
        if (nvmePercent >= 90) {
          return [{ level: 'danger', percent: nvmePercent }];
        }
        if (nvmePercent >= 75) {
          return [{ level: 'warning', percent: nvmePercent }];
        }
        return [];
      }),
    );
  }

  /** MISSING: GET /api/servers/:id/stats (TPS and JVM memory). */
  serverRuntimeStats(serverId: string): Observable<ServerRuntimeStats> {
    return of<ServerRuntimeStats>({
      tps: 19.8,
      jvmUsedMb: 2312,
      jvmMaxMb: 4096,
      uptimeSeconds: 3 * 3600 + 14 * 60 + serverId.length,
    }).pipe(delay(LATENCY_MS));
  }

  /** MISSING: GET /api/servers/:id/players (online players and session time). */
  serverPlayers(serverId: string): Observable<ServerPlayers> {
    return of<ServerPlayers>({
      online: 2,
      max: 20,
      players: [
        { nick: 'Steve', sessionSeconds: 1860 + serverId.length },
        { nick: 'Alex', sessionSeconds: 420 },
      ],
    }).pipe(delay(LATENCY_MS));
  }

  /** MISSING: changing allocated_memory_mb after creation; PATCH /api/servers/:id does not accept it yet. */
  updateServerSettings(
    _serverId: string,
    patch: ServerSettingsPatch,
  ): Observable<ServerSettingsPatch> {
    return of(patch).pipe(delay(LATENCY_MS));
  }

  /** MISSING: progress events for backup/restore on /ws/tasks (only modpack installs emit taskProgress). */
  backupProgress(taskId: string, serverId: string): Observable<TaskProgress> {
    const steps = ['Congelando escrita', 'Compactando mundo', 'Calculando SHA-256', 'Concluído'];
    return timer(0, 600).pipe(
      take(steps.length),
      map((i) => ({
        taskId,
        serverId,
        status: i === steps.length - 1 ? 'COMPLETED' : 'IN_PROGRESS',
        progressPercent: Math.round(((i + 1) / steps.length) * 100),
        downloadedFiles: 0,
        totalFiles: 0,
        currentStep: steps[i],
      })),
    );
  }
}
