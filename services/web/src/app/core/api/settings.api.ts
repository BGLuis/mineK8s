import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import { SettingsChanges, SettingsSnapshot } from './models';

/** settings.controller.ts, `api/settings` (admin). The server never returns secret values. */
@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly api = inject(ApiClient);

  get(): Observable<SettingsSnapshot> {
    return this.api.get('/api/settings');
  }

  /** All or nothing: a single invalid value rejects the whole request. */
  update(values: SettingsChanges): Observable<SettingsSnapshot> {
    return this.api.patch('/api/settings', { values });
  }
}
