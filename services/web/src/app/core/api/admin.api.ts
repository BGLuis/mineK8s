import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import {
  AccessibleServer,
  CreateGroupRequest,
  Group,
  RemoveUserFromGroupResponse,
  SmartKickRequest,
  SuccessResponse,
  UserSummary,
} from './models';

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
}
