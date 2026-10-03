import { Injectable, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';

import { AdminApi, ServersApi, TailscaleApi } from '../../core/api';

/** Data shared by the panels of the access screen; provided by AccessPage so it lives with the screen. */
@Injectable()
export class AccessStore {
  private readonly tailscale = inject(TailscaleApi);
  private readonly admin = inject(AdminApi);
  private readonly serversApi = inject(ServersApi);

  readonly servers = rxResource({ stream: () => this.serversApi.list() });
  readonly groups = rxResource({ stream: () => this.admin.listGroups() });
  readonly invites = rxResource({ stream: () => this.tailscale.listInvites() });
  readonly devices = rxResource({ stream: () => this.tailscale.listDevices() });
  /** Only the group editor needs it. */
  readonly users = rxResource({ stream: () => this.admin.listUsers() });
}
