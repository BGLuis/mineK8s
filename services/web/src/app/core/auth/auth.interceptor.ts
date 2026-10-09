import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { AuthSession } from './auth-session';
import { TokenStore } from './token-store';

const PUBLIC_PATHS = [
  '/api/auth/session',
  '/api/auth/bootstrap',
  '/api/tailscale/claim',
  '/api/tailscale/invites/validate/',
];

export function isApiUrl(url: string): boolean {
  return url.startsWith('/api/');
}

/** Adds the Bearer token to API calls only, so it never leaks to third-party hosts. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(TokenStore).token();
  const session = inject(AuthSession);
  const router = inject(Router);

  const authed =
    token && isApiUrl(req.url)
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

  return next(authed).pipe(
    catchError((error: unknown) => {
      const isPublic = PUBLIC_PATHS.some((path) => req.url.startsWith(path));
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        isApiUrl(req.url) &&
        !isPublic
      ) {
        session.logout();
        const currentUrl = router.url;
        const redirect = currentUrl.startsWith('/login')
          ? router.parseUrl(currentUrl).queryParams['redirect']
          : currentUrl && currentUrl !== '/'
            ? currentUrl
            : undefined;
        if (redirect) {
          void router.navigate(['/login'], { queryParams: { redirect } });
        } else {
          void router.navigate(['/login']);
        }
      }
      return throwError(() => error);
    }),
  );
};
