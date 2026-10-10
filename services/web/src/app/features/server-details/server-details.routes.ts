import { Routes } from '@angular/router';
import { canDeactivateFiles } from './files/files-unsaved.guard';

export const SERVER_DETAILS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./server-details.page').then((m) => m.ServerDetailsPage),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Servidor · mineK8s',
        loadComponent: () =>
          import('./overview/server-overview.page').then((m) => m.ServerOverviewPage),
      },
      {
        path: 'console',
        title: 'Console · mineK8s',
        loadComponent: () =>
          import('./console/server-console.page').then((m) => m.ServerConsolePage),
      },
      {
        path: 'world',
        title: 'Mundo · mineK8s',
        loadComponent: () => import('./world/server-world.page').then((m) => m.ServerWorldPage),
      },
      {
        path: 'files',
        title: 'Arquivos · mineK8s',
        canDeactivate: [canDeactivateFiles],
        loadComponent: () => import('./files/server-files.page').then((m) => m.ServerFilesPage),
      },
      {
        path: 'backups',
        title: 'Backups · mineK8s',
        loadComponent: () =>
          import('./backups/server-backups.page').then((m) => m.ServerBackupsPage),
      },
    ],
  },
];
