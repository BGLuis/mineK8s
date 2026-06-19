import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ModpackResult {
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  versions: string[];
  iconUrl: string;
  categories: string[];
  source: string;
}

export interface SearchResponse {
  total: number;
  results: ModpackResult[];
}

@Injectable({
  providedIn: 'root'
})
export class ModpacksService {
  private apiUrl = '/api/modpacks';

  constructor(private http: HttpClient) {}

  search(query: string, limit: number = 20, source?: string): Observable<any> {
    let params: any = { q: query, limit: limit.toString() };
    if (source && source !== 'All') {
      params.source = source;
    }
    return this.http.get<any>(`${this.apiUrl}/search`, { params });
  }

  getVersions(id: string, source: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/${id}/versions`, {
      params: { source }
    });
  }
}
