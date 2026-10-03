import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import {
  ClaimInviteRequest,
  ClaimResult,
  CreateInviteRequest,
  DeviceGcResponse,
  InviteSummary,
  PostureAuditReport,
  RevokeDeviceResponse,
  TailscaleDevice,
} from './models';

/** tailscale.controller.ts, `api/tailscale`. validateInvite and claim are public (/join). */
@Injectable({ providedIn: 'root' })
export class TailscaleApi {
  private readonly api = inject(ApiClient);

  postureAudit(refresh = false): Observable<PostureAuditReport> {
    return this.api.get('/api/tailscale/posture-audit', {
      params: { refresh: refresh ? 'true' : undefined },
    });
  }

  /** Red-team simulation of a raw huJSON policy; does not change the tailnet. */
  evaluatePolicy(policy: Record<string, unknown>): Observable<PostureAuditReport> {
    return this.api.post('/api/tailscale/posture-audit/evaluate', policy);
  }

  createInvite(dto: CreateInviteRequest): Observable<InviteSummary> {
    return this.api.post('/api/tailscale/invites', dto);
  }

  listInvites(): Observable<InviteSummary[]> {
    return this.api.get('/api/tailscale/invites');
  }

  getInvite(id: string): Observable<InviteSummary> {
    return this.api.get(`/api/tailscale/invites/${id}`);
  }

  revokeInvite(id: string): Observable<InviteSummary> {
    return this.api.delete(`/api/tailscale/invites/${id}`);
  }

  validateInvite(token: string): Observable<InviteSummary> {
    return this.api.get(`/api/tailscale/invites/validate/${encodeURIComponent(token)}`);
  }

  claim(dto: ClaimInviteRequest): Observable<ClaimResult> {
    return this.api.post('/api/tailscale/claim', dto);
  }

  listDevices(): Observable<TailscaleDevice[]> {
    return this.api.get('/api/tailscale/devices');
  }

  getDevice(id: string): Observable<TailscaleDevice> {
    return this.api.get(`/api/tailscale/devices/${id}`);
  }

  revokeDevice(id: string): Observable<RevokeDeviceResponse> {
    return this.api.delete(`/api/tailscale/devices/${id}`);
  }

  /** DeviceGarbageCollector: the server defaults to 30 days when `days` is omitted. */
  collectGarbage(days?: number): Observable<DeviceGcResponse> {
    return this.api.post('/api/tailscale/devices/gc', {}, { params: { days } });
  }
}
