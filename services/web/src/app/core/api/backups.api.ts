import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import {
  BackupMode,
  CreateBackupResponse,
  DeleteBackupResponse,
  RestoreBackupResponse,
  ServerBackup,
} from './models';

/** servers.controller.ts, backup routes under `api/servers/:id/backups`. */
@Injectable({ providedIn: 'root' })
export class BackupsApi {
  private readonly api = inject(ApiClient);

  create(serverId: string, type: BackupMode = 'HOT'): Observable<CreateBackupResponse> {
    return this.api.post(`/api/servers/${serverId}/backups`, { type });
  }

  list(serverId: string): Observable<ServerBackup[]> {
    return this.api.get(`/api/servers/${serverId}/backups`);
  }

  delete(serverId: string, backupId: string, force = false): Observable<DeleteBackupResponse> {
    return this.api.delete(`/api/servers/${serverId}/backups/${backupId}`, {
      params: { force: force ? 'true' : undefined },
    });
  }

  restore(serverId: string, backupId: string): Observable<RestoreBackupResponse> {
    return this.api.post(`/api/servers/${serverId}/backups/${backupId}/restore`);
  }

  /** Blob download: a plain link would not carry the Authorization header. */
  download(serverId: string, backupId: string): Observable<Blob> {
    return this.api.getBlob(`/api/servers/${serverId}/backups/${backupId}/download`);
  }
}
