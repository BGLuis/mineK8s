import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import { FileContent, FileListing, MessageResponse, WorldUploadResponse } from './models';

/** servers.controller.ts, file routes under `api/servers/:id`. */
@Injectable({ providedIn: 'root' })
export class FilesApi {
  private readonly api = inject(ApiClient);

  list(serverId: string, path = ''): Observable<FileListing> {
    return this.api.get(`/api/servers/${serverId}/files`, { params: { path } });
  }

  read(serverId: string, path: string): Observable<FileContent> {
    return this.api.get(`/api/servers/${serverId}/file`, { params: { path } });
  }

  write(serverId: string, path: string, content: string): Observable<MessageResponse> {
    return this.api.put(`/api/servers/${serverId}/file`, { content }, { params: { path } });
  }

  delete(serverId: string, path: string): Observable<MessageResponse> {
    return this.api.delete(`/api/servers/${serverId}/file`, { params: { path } });
  }

  /** Multipart field name is `file`; the server must be stopped. */
  uploadWorld(serverId: string, file: File): Observable<WorldUploadResponse> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.api.postForm(`/api/servers/${serverId}/world/upload`, form);
  }
}
