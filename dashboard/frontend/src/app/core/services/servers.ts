import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CreateServerPayload {
  name: string;
  source: string;
  modpackId?: string;
  modpackSlug?: string;
  version?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ServersService {
  private apiUrl = '/api/servers';

  constructor(private http: HttpClient) {}

  createServer(payload: CreateServerPayload): Observable<any> {
    return this.http.post(`${this.apiUrl}/create`, payload);
  }

  getServers(): Observable<any[]> {
    return this.http.get<any[]>(this.apiUrl);
  }

  startServer(id: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/${id}/start`, {});
  }

  stopServer(id: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/${id}/stop`, {});
  }

  deleteServer(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }

  getPlayers(id: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${id}/players`);
  }

  sendCommand(id: string, command: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/${id}/command`, { command });
  }

  uploadWorld(id: string, file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${this.apiUrl}/${id}/world/upload`, formData);
  }
}
