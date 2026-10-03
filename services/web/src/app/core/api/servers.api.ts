import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import {
  CommandResponse,
  CreateServerRequest,
  CreateServerResponse,
  MessageResponse,
  PublishResponse,
  ServerDetail,
  ServerLogsResponse,
  ServerSummary,
  UpdateServerRequest,
  UpdateVersionRequest,
  UpdateVersionResponse,
} from './models';

/** servers.controller.ts, `api/servers`. */
@Injectable({ providedIn: 'root' })
export class ServersApi {
  private readonly api = inject(ApiClient);

  list(): Observable<ServerSummary[]> {
    return this.api.get('/api/servers');
  }

  get(id: string): Observable<ServerDetail> {
    return this.api.get(`/api/servers/${id}`);
  }

  create(dto: CreateServerRequest): Observable<CreateServerResponse> {
    return this.api.post('/api/servers', dto);
  }

  start(id: string): Observable<MessageResponse> {
    return this.api.post(`/api/servers/${id}/start`);
  }

  stop(id: string): Observable<MessageResponse> {
    return this.api.post(`/api/servers/${id}/stop`);
  }

  restart(id: string): Observable<MessageResponse> {
    return this.api.post(`/api/servers/${id}/restart`);
  }

  update(id: string, patch: UpdateServerRequest): Observable<ServerDetail> {
    return this.api.patch(`/api/servers/${id}`, patch);
  }

  updateVersion(id: string, dto: UpdateVersionRequest): Observable<UpdateVersionResponse> {
    return this.api.post(`/api/servers/${id}/update-version`, dto);
  }

  delete(id: string): Observable<MessageResponse> {
    return this.api.delete(`/api/servers/${id}`);
  }

  updateDomain(id: string, domain: string): Observable<MessageResponse> {
    return this.api.patch(`/api/servers/${id}/domain`, { domain });
  }

  logs(id: string, tail = 150): Observable<ServerLogsResponse> {
    return this.api.get(`/api/servers/${id}/logs`, { params: { tail } });
  }

  sendCommand(id: string, command: string): Observable<CommandResponse> {
    return this.api.post(`/api/servers/${id}/command`, { command });
  }

  publish(id: string): Observable<PublishResponse> {
    return this.api.post(`/api/servers/${id}/publish`);
  }

  unpublish(id: string): Observable<PublishResponse> {
    return this.api.delete(`/api/servers/${id}/publish`);
  }
}
