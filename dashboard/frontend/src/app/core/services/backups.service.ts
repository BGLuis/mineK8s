import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface BackupFile {
  filename: string;
  serverId: string;
  createdAt: string;
  sizeMb: number | null;
}

@Injectable({
  providedIn: 'root'
})
export class BackupsService {
  private http = inject(HttpClient);
  private apiUrl = '/api/backups';

  listBackups(serverId: string): Observable<BackupFile[]> {
    return this.http.get<BackupFile[]>(`${this.apiUrl}/${serverId}`);
  }

  createBackup(serverId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/${serverId}`, {});
  }

  restoreBackup(serverId: string, filename: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/${serverId}/restore`, { filename });
  }

  getJobStatus(jobName: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/status/${jobName}`);
  }
}
