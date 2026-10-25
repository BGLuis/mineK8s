import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';

import { AuthSession } from './auth-session';
import { TokenStore } from './token-store';

/** Requires a valid session; redirects to /login keeping the intended URL. */
export const authGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const login = router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });

  if (!inject(TokenStore).token()) {
    return login;
  }
  return inject(AuthSession)
    .restore()
    .pipe(map((user) => (user ? true : login)));
};

/** Protects admin-only routes: redirects unauthenticated users to /login and PLAYER users to /meus-mundos. */
export const adminGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(AuthSession)
    .restore()
    .pipe(
      map((user) => {
        if (!user) return router.createUrlTree(['/login']);
        if (user.role !== 'ADMIN') return router.createUrlTree(['/meus-mundos']);
        return true;
      }),
    );
};
