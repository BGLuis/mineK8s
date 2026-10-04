import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  params?: QueryParams;
}

/** Thin typed wrapper over HttpClient. Paths are relative; the dev proxy and the interceptor handle the rest. */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  get<T>(path: string, options?: RequestOptions): Observable<T> {
    return this.http.get<T>(path, { params: toParams(options?.params) });
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Observable<T> {
    return this.http.post<T>(path, body ?? {}, { params: toParams(options?.params) });
  }

  put<T>(path: string, body: unknown, options?: RequestOptions): Observable<T> {
    return this.http.put<T>(path, body, { params: toParams(options?.params) });
  }

  patch<T>(path: string, body: unknown, options?: RequestOptions): Observable<T> {
    return this.http.patch<T>(path, body, { params: toParams(options?.params) });
  }

  delete<T>(path: string, options?: RequestOptions): Observable<T> {
    return this.http.delete<T>(path, { params: toParams(options?.params) });
  }

  getBlob(path: string, options?: RequestOptions): Observable<Blob> {
    return this.http.get(path, { params: toParams(options?.params), responseType: 'blob' });
  }

  postForm<T>(path: string, form: FormData): Observable<T> {
    return this.http.post<T>(path, form);
  }
}

export function toParams(params?: QueryParams): HttpParams {
  let result = new HttpParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      result = result.set(key, String(value));
    }
  }
  return result;
}
