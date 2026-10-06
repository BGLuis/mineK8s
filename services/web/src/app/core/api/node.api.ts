import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import { NodeMetrics } from './models';

/** node.controller.ts (`api/node`), admin only. */
@Injectable({ providedIn: 'root' })
export class NodeApi {
  private readonly api = inject(ApiClient);

  metrics(): Observable<NodeMetrics> {
    return this.api.get('/api/node/metrics');
  }
}
