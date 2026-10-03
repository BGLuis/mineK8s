import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import { BootstrapRequest, BootstrapResponse, LoginRequest, TokenResponse, User } from './models';

/** auth.controller.ts, `api/auth`. `bootstrap` and `token` are public. */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly api = inject(ApiClient);

  bootstrap(dto: BootstrapRequest): Observable<BootstrapResponse> {
    return this.api.post('/api/auth/bootstrap', dto);
  }

  token(dto: LoginRequest): Observable<TokenResponse> {
    return this.api.post('/api/auth/token', dto);
  }

  me(): Observable<User> {
    return this.api.get('/api/auth/me');
  }
}
