import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ServerMetrics {
  serverId: string;
  cpuCores: number;
  memoryMb: number;
}

@Injectable({
  providedIn: 'root'
})
export class MonitoringService {
  private http = inject(HttpClient);
  private apiUrl = '/api/monitoring';

  getAllMetrics(): Observable<ServerMetrics[]> {
    return this.http.get<ServerMetrics[]>(this.apiUrl);
  }

  getServerMetrics(serverId: string): Observable<ServerMetrics> {
    return this.http.get<ServerMetrics>(`${this.apiUrl}/${serverId}`);
  }
}
