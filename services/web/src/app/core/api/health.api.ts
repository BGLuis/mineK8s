import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import {
  HealthBotOverview,
  HealthBotReport,
  ReconciliationSummary,
  ReconcilerStatus,
} from './models';

/** health-bot.controller.ts (`api/health-bot`) and reconciler.controller.ts (`api/reconciler`). */
@Injectable({ providedIn: 'root' })
export class HealthApi {
  private readonly api = inject(ApiClient);

  overview(): Observable<HealthBotOverview> {
    return this.api.get('/api/health-bot/overview');
  }

  /** The server caps `limit` at 50 (default 20). */
  reports(serverId: string, limit?: number): Observable<HealthBotReport[]> {
    return this.api.get(`/api/health-bot/servers/${serverId}/reports`, { params: { limit } });
  }

  probe(serverId: string): Observable<HealthBotReport> {
    return this.api.post(`/api/health-bot/servers/${serverId}/probe`);
  }

  triggerReconciliation(): Observable<ReconciliationSummary> {
    return this.api.post('/api/reconciler/trigger');
  }

  reconcilerStatus(): Observable<ReconcilerStatus> {
    return this.api.get('/api/reconciler/status');
  }
}
