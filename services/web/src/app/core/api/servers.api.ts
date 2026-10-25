import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import {
  CommandResponse,
  CreateServerRequest,
  CreateServerResponse,
  MessageResponse,
  MinecraftVersionItem,
  PublishResponse,
  ServerDetail,
  ServerLogsResponse,
  ServerPlayers,
  ServerRuntimeStats,
  ServerSummary,
  StopServerRequest,
  UpdateServerRequest,
  UpdateServerSettingsRequest,
  UpdateVersionRequest,
  UpdateVersionResponse,
  CompatibilityPreviewResponse,
  ServerContentItem,
  PlayerServer,
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

  stats(id: string, window = '60m'): Observable<ServerRuntimeStats> {
    return this.api.get(`/api/servers/${id}/stats`, { params: { window } });
  }

  create(dto: CreateServerRequest): Observable<CreateServerResponse> {
    return this.api.post('/api/servers', dto);
  }

  start(id: string): Observable<MessageResponse> {
    return this.api.post(`/api/servers/${id}/start`);
  }

  stop(id: string, dto?: StopServerRequest): Observable<MessageResponse & { taskId?: string }> {
    return this.api.post(`/api/servers/${id}/stop`, dto ?? {});
  }

  restart(id: string, dto?: StopServerRequest): Observable<MessageResponse & { taskId?: string }> {
    return this.api.post(`/api/servers/${id}/restart`, dto ?? {});
  }

  cancelStop(id: string): Observable<MessageResponse> {
    return this.api.post(`/api/servers/${id}/cancel-stop`);
  }

  update(id: string, patch: UpdateServerRequest): Observable<ServerDetail> {
    return this.api.patch(`/api/servers/${id}`, patch);
  }

  updateVersion(id: string, dto: UpdateVersionRequest): Observable<UpdateVersionResponse> {
    return this.api.post(`/api/servers/${id}/update-version`, dto);
  }

  previewUpdateVersion(
    id: string,
    dto: {
      game_version: string;
      server_type?: string;
      modpack_id?: string;
      modpack_version_id?: string;
    },
  ): Observable<CompatibilityPreviewResponse> {
    return this.api.post(`/api/servers/${id}/update-version/preview`, dto);
  }

  identifyContent(id: string): Observable<ServerContentItem[]> {
    return this.api.post(`/api/servers/${id}/content/identify`);
  }

  listContent(id: string): Observable<ServerContentItem[]> {
    return this.api.get(`/api/servers/${id}/content`);
  }

  delete(id: string): Observable<MessageResponse> {
    return this.api.delete(`/api/servers/${id}`);
  }

  updateSettings(id: string, patch: UpdateServerSettingsRequest): Observable<ServerDetail> {
    return this.api.patch(`/api/servers/${id}/settings`, patch);
  }

  /** The 64x64 PNG shown in the Minecraft server list; 404 when the server has none. */
  icon(id: string): Observable<Blob> {
    return this.api.getBlob(`/api/servers/${id}/icon`);
  }

  setIcon(id: string, image: Blob): Observable<MessageResponse> {
    const form = new FormData();
    form.append('file', image, 'server-icon.png');
    return this.api.put(`/api/servers/${id}/icon`, form);
  }

  removeIcon(id: string): Observable<MessageResponse> {
    return this.api.delete(`/api/servers/${id}/icon`);
  }

  updateDomain(id: string, domain: string): Observable<MessageResponse> {
    return this.api.patch(`/api/servers/${id}/domain`, { domain });
  }

  logs(id: string, tail = 150): Observable<ServerLogsResponse> {
    return this.api.get(`/api/servers/${id}/logs`, { params: { tail } });
  }

  players(id: string): Observable<ServerPlayers> {
    return this.api.get(`/api/servers/${id}/players`);
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

  listMinecraftVersions(type: string, snapshots = false): Observable<MinecraftVersionItem[]> {
    return this.api.get('/api/minecraft/versions', {
      params: { type, snapshots: String(snapshots) },
    });
  }

  listMyServers(): Observable<PlayerServer[]> {
    return this.api.get('/api/me/servers');
  }
}
