import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import {
  InstallModpackRequest,
  InstallModpackResponse,
  ModpackSearchResponse,
  ModpackVersion,
} from './models';

/** modpacks.controller.ts, `api/modpacks/*` and `api/servers/:id/modpack/install`. */
@Injectable({ providedIn: 'root' })
export class ModpacksApi {
  private readonly api = inject(ApiClient);

  search(
    query?: string,
    options: { limit?: number; source?: 'curseforge' | 'modrinth' } = {},
  ): Observable<ModpackSearchResponse> {
    return this.api.get('/api/modpacks/search', {
      params: { query, limit: options.limit, source: options.source },
    });
  }

  versions(modpackId: string, source?: string): Observable<ModpackVersion[]> {
    return this.api.get(`/api/modpacks/${modpackId}/versions`, { params: { source } });
  }

  install(serverId: string, dto: InstallModpackRequest): Observable<InstallModpackResponse> {
    return this.api.post(`/api/servers/${serverId}/modpack/install`, dto);
  }
}
