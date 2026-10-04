import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';

import { AuthApi } from '../api/auth.api';
import { BootstrapRequest, TokenResponse, User } from '../api/models';
import { TokenStore } from './token-store';

/** Current user and session lifecycle; the JWT itself lives in TokenStore. */
@Injectable({ providedIn: 'root' })
export class AuthSession {
  private readonly api = inject(AuthApi);
  private readonly tokens = inject(TokenStore);

  private readonly _user = signal<User | null>(null);
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this.tokens.token() !== null);
  readonly isAdmin = computed(() => this._user()?.role === 'ADMIN');

  login(minecraftNick: string): Observable<User> {
    return this.api.token({ minecraft_nick: minecraftNick }).pipe(
      tap((res) => this.accept(res)),
      map((res) => res.user),
    );
  }

  bootstrap(dto: BootstrapRequest): Observable<User> {
    return this.api.bootstrap(dto).pipe(
      tap((res) => this.accept(res)),
      map((res) => res.user),
    );
  }

  /** Loads the profile for a token restored from sessionStorage. Emits null when the token is invalid. */
  restore(): Observable<User | null> {
    if (this._user()) {
      return of(this._user());
    }
    if (!this.tokens.token()) {
      return of(null);
    }
    return this.api.me().pipe(
      tap((user) => this._user.set(user)),
      catchError(() => {
        this.logout();
        return of(null);
      }),
    );
  }

  logout(): void {
    this.tokens.clear();
    this._user.set(null);
  }

  private accept(res: TokenResponse): void {
    this.tokens.set(res.access_token);
    this._user.set(res.user);
  }
}
