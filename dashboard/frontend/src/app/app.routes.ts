import { Routes } from '@angular/router';
import { AccessControlComponent } from './features/access-control/access-control';
import { ModpackGallery } from './features/modpack-gallery/modpack-gallery';
import { ServerBackups } from './features/server-backups/server-backups';
import { ServerConsole } from './features/server-console/server-console';
import { ServerDetailsComponent } from './features/server-details/server-details.component';
import { ServerFiles } from './features/server-files/server-files';
import { ServerManager } from './features/server-manager/server-manager';
import { ServerPlayers } from './features/server-players/server-players';

export const routes: Routes = [
	{ path: '', component: ServerManager },
	{ path: 'marketplace', component: ModpackGallery },
	{ path: 'access-control', component: AccessControlComponent },
	{ path: 'server/:id/dashboard', component: ServerDetailsComponent },
	{ path: 'server/:id/console', component: ServerConsole },
	{ path: 'server/:id/files', component: ServerFiles },
	{ path: 'server/:id/players', component: ServerPlayers },
	{ path: 'server/:id/backups', component: ServerBackups },
];
