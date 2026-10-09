import { Routes } from '@angular/router';

export const devRoutes: Routes = [
  {
    path: 'dev/ui',
    title: 'Galeria de UI',
    loadComponent: () => import('./ui-gallery').then((m) => m.UiGallery),
  },
];
