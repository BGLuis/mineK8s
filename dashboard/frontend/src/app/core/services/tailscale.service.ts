import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CreateInviteDto {
  playerName: string;
  scope: 'global' | 'group' | 'individual';
  serverIds?: string[];
  expiresInDays?: number;
}

@Injectable({
  providedIn: 'root'
})
export class TailscaleService {
  private http = inject(HttpClient);
  // URL base adaptável para desenvolvimento ou produção
  private apiUrl = '/api/tailscale'; 

  createInvite(dto: CreateInviteDto): Observable<any> {
    return this.http.post(`${this.apiUrl}/invite`, dto);
  }

  listDevices(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/devices`);
  }

  revokeDevice(deviceId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/devices/${deviceId}`);
  }
}
