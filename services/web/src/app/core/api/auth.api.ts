import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import { BootstrapRequest, BootstrapResponse, TokenResponse, User } from './models';

/** auth.controller.ts, `api/auth`. `bootstrap` and `session` are public. */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly api = inject(ApiClient);

  bootstrap(dto: BootstrapRequest): Observable<BootstrapResponse> {
    return this.api.post('/api/auth/bootstrap', dto);
  }

  /** The control plane identifies the caller by the IP the request comes from (Tailscale WhoIs). */
  session(): Observable<TokenResponse> {
    return this.api.post('/api/auth/session');
  }

  me(): Observable<User> {
    return this.api.get('/api/auth/me');
  }
}
