import { Injectable } from '@angular/core';
import { Observable, delay, map, of, take, timer } from 'rxjs';

import { ServerRuntimeStats, TaskProgress } from './models';

const LATENCY_MS = 250;

/**
 * Fake data for features the backend does not implement (design report §2.6).
 * Every consumer must render `mc-no-api-tag` next to what comes from here.
 */
@Injectable({ providedIn: 'root' })
export class MockApi {
  /** MISSING: GET /api/servers/:id/stats (TPS and JVM memory). */
  serverRuntimeStats(serverId: string): Observable<ServerRuntimeStats> {
    return of<ServerRuntimeStats>({
      tps: 19.8,
      jvmUsedMb: 2312,
      jvmMaxMb: 4096,
      uptimeSeconds: 3 * 3600 + 14 * 60 + serverId.length,
    }).pipe(delay(LATENCY_MS));
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
