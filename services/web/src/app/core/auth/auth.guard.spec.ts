import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';

import { AuthSession } from './auth-session';
import { TokenStore } from './token-store';
import { adminGuard, authGuard } from './auth.guard';

describe('Auth Guards (#216)', () => {
  let router: Router;
  let mockAuthSession: { restore: ReturnType<typeof vi.fn> };
  let mockTokenStore: { token: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockAuthSession = {
      restore: vi.fn(),
    };
    mockTokenStore = {
      token: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSession, useValue: mockAuthSession },
        { provide: TokenStore, useValue: mockTokenStore },
      ],
    });

    router = TestBed.inject(Router);
  });

  describe('adminGuard', () => {
    it('redirects to /login when unauthenticated', async () => {
      mockAuthSession.restore.mockReturnValue(of(null));

      const result = await firstValueFrom(
        TestBed.runInInjectionContext(() => adminGuard({} as any, {} as any)) as Observable<
          boolean | UrlTree
        >,
      );

      expect(result instanceof UrlTree).toBe(true);
      expect((result as UrlTree).toString()).toBe('/login');
    });

    it('redirects to /meus-mundos when user is a PLAYER', async () => {
      mockAuthSession.restore.mockReturnValue(of({ id: 'u1', role: 'PLAYER' }));

      const result = await firstValueFrom(
        TestBed.runInInjectionContext(() => adminGuard({} as any, {} as any)) as Observable<
          boolean | UrlTree
        >,
      );

      expect(result instanceof UrlTree).toBe(true);
      expect((result as UrlTree).toString()).toBe('/meus-mundos');
    });

    it('allows access (returns true) when user is an ADMIN', async () => {
      mockAuthSession.restore.mockReturnValue(of({ id: 'u1', role: 'ADMIN' }));

      const result = await firstValueFrom(
        TestBed.runInInjectionContext(() => adminGuard({} as any, {} as any)) as Observable<
          boolean | UrlTree
        >,
      );

      expect(result).toBe(true);
    });
  });

  describe('authGuard', () => {
    it('redirects to /login?redirect=... when token is missing', () => {
      mockTokenStore.token.mockReturnValue(null);

      const result = TestBed.runInInjectionContext(() =>
        authGuard({} as any, { url: '/servers/1' } as any),
      );

      expect(result instanceof UrlTree).toBe(true);
      expect((result as UrlTree).toString()).toBe('/login?redirect=%2Fservers%2F1');
    });

    it('returns true when token is valid and session restored', async () => {
      mockTokenStore.token.mockReturnValue('jwt-token');
      mockAuthSession.restore.mockReturnValue(of({ id: 'u1', role: 'PLAYER' }));

      const result = await firstValueFrom(
        TestBed.runInInjectionContext(() =>
          authGuard({} as any, { url: '/meus-mundos' } as any),
        ) as Observable<boolean | UrlTree>,
      );

      expect(result).toBe(true);
    });
  });
});
