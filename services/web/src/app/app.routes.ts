import { Routes } from '@angular/router';

import { adminGuard, authGuard } from './core/auth/auth.guard';
import { devRoutes } from './dev/dev-routes';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Entrar · mineK8s',
    loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'join',
    title: 'Entrar na rede · mineK8s',
    loadComponent: () => import('./features/join/join.page').then((m) => m.JoinPage),
  },
  {
    path: 'meus-mundos',
    canActivate: [authGuard],
    title: 'Meus mundos · mineK8s',
    loadComponent: () =>
      import('./features/player/player-worlds.page').then((m) => m.PlayerWorldsPage),
  },
  ...devRoutes,
  {
    path: '',
    canActivate: [authGuard, adminGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.ShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Dashboard · mineK8s',
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'servers/new',
        title: 'Criar servidor · mineK8s',
        loadComponent: () =>
          import('./features/create-server/create-server.page').then((m) => m.CreateServerPage),
      },
      {
        path: 'servers/:id',
        loadChildren: () =>
          import('./features/server-details/server-details.routes').then(
            (m) => m.SERVER_DETAILS_ROUTES,
          ),
      },
      {
        path: 'access',
        title: 'Convidados e acesso · mineK8s',
        loadComponent: () => import('./features/access/access.page').then((m) => m.AccessPage),
      },
      {
        path: 'access/users/:id',
        title: 'Detalhes do usuário · mineK8s',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/access/user-detail.page').then((m) => m.UserDetailPage),
      },
      {
        path: 'health',
        title: 'Saúde do sistema · mineK8s',
        loadComponent: () => import('./features/health/health.page').then((m) => m.HealthPage),
      },
      {
        path: 'settings',
        title: 'Configurações · mineK8s',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
