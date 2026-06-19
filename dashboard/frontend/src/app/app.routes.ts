import { Routes } from '@angular/router';
import { ModpackGallery } from './features/modpack-gallery/modpack-gallery';
import { ServerManager } from './features/server-manager/server-manager';
import { ServerConsole } from './features/server-console/server-console';
import { ServerFiles } from './features/server-files/server-files';
import { ServerPlayers } from './features/server-players/server-players';
import { ServerBackups } from './features/server-backups/server-backups';
import { TailscaleNetwork } from './features/tailscale-network/tailscale-network';

export const routes: Routes = [
  { path: '', component: ServerManager },
  { path: 'marketplace', component: ModpackGallery },
  { path: 'network', component: TailscaleNetwork },
  { path: 'server/:id/console', component: ServerConsole },
  { path: 'server/:id/files', component: ServerFiles },
  { path: 'server/:id/players', component: ServerPlayers },
  { path: 'server/:id/backups', component: ServerBackups }
];
