import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import {
  AccessChangeItem,
  AccessMatrixResponse,
  AccessibleServer,
  CreateGroupRequest,
  Group,
  RemoveUserFromGroupResponse,
  SimulatedUserAccessResult,
  SmartKickRequest,
  SuccessResponse,
  UserSummary,
  UserWorldAccess,
} from './models';

export type { AccessMatrixResponse };

/** admin.controller.ts, `api/admin`. */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly api = inject(ApiClient);

  listUsers(): Observable<UserSummary[]> {
    return this.api.get('/api/admin/users');
  }

  listAccessibleServers(userId: string): Observable<AccessibleServer[]> {
    return this.api.get(`/api/admin/users/${userId}/servers`);
  }

  explainUserAccess(userId: string): Observable<UserWorldAccess[]> {
    return this.api.get(`/api/admin/users/${userId}/access`);
  }

  getAccessMatrix(): Observable<AccessMatrixResponse> {
    return this.api.get('/api/admin/access/matrix');
  }

  grantUserServer(userId: string, serverId: string): Observable<SuccessResponse> {
    return this.api.post(`/api/admin/users/${userId}/servers`, { serverId });
  }

  revokeUserServer(userId: string, serverId: string): Observable<{ kickedServers: string[] }> {
    return this.api.delete(`/api/admin/users/${userId}/servers/${serverId}`);
  }

  createGroup(dto: CreateGroupRequest): Observable<Group> {
    return this.api.post('/api/admin/groups', dto);
  }

  listGroups(): Observable<Group[]> {
    return this.api.get('/api/admin/groups');
  }

  deleteGroup(id: string): Observable<SuccessResponse> {
    return this.api.delete(`/api/admin/groups/${id}`);
  }

  addUserToGroup(groupId: string, userId: string): Observable<SuccessResponse> {
    return this.api.post(`/api/admin/groups/${groupId}/users`, { userId });
  }

  /** Triggers a Smart Kick on every running server the user loses access to. */
  removeUserFromGroup(groupId: string, userId: string): Observable<RemoveUserFromGroupResponse> {
    return this.api.delete(`/api/admin/groups/${groupId}/users/${userId}`);
  }

  addServerToGroup(groupId: string, serverId: string): Observable<SuccessResponse> {
    return this.api.post(`/api/admin/groups/${groupId}/servers`, { serverId });
  }

  removeServerFromGroup(groupId: string, serverId: string): Observable<SuccessResponse> {
    return this.api.delete(`/api/admin/groups/${groupId}/servers/${serverId}`);
  }

  smartKick(dto: SmartKickRequest): Observable<SuccessResponse> {
    return this.api.post('/api/admin/smart-kick', dto);
  }

  simulateAccess(changes: AccessChangeItem[]): Observable<SimulatedUserAccessResult[]> {
    return this.api.post('/api/admin/access/simulate', { changes });
  }
}
