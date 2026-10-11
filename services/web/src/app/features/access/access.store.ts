import { Injectable, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';

import { AdminApi, ServersApi, SettingsApi, TailscaleApi } from '../../core/api';
import { inviteKeyEnabled, nodeSharingEnabled } from '../settings/settings.logic';

/** Data shared by the panels of the access screen; provided by AccessPage so it lives with the screen. */
@Injectable()
export class AccessStore {
  private readonly tailscale = inject(TailscaleApi);
  private readonly admin = inject(AdminApi);
  private readonly serversApi = inject(ServersApi);
  private readonly settingsApi = inject(SettingsApi);

  readonly servers = rxResource({ stream: () => this.serversApi.list() });
  readonly groups = rxResource({ stream: () => this.admin.listGroups() });
  readonly invites = rxResource({ stream: () => this.tailscale.listInvites() });
  readonly devices = rxResource({ stream: () => this.tailscale.listDevices() });
  /** Only the group editor needs it. */
  readonly users = rxResource({ stream: () => this.admin.listUsers() });
  readonly settings = rxResource({ stream: () => this.settingsApi.get() });
  /** Same rule as keyInvitesEnabled: null while loading, enabled when the settings cannot be read. */
  readonly nodeSharingEnabled = computed<boolean | null>(() => {
    if (this.settings.error()) {
      return true;
    }
    const snapshot = this.settings.value();
    return snapshot ? nodeSharingEnabled(snapshot) : null;
  });
  /** Null while loading. Failing to read the settings counts as enabled: the server refuses the call anyway. */
  readonly keyInvitesEnabled = computed<boolean | null>(() => {
    if (this.settings.error()) {
      return true;
    }
    const snapshot = this.settings.value();
    return snapshot ? inviteKeyEnabled(snapshot) : null;
  });
}
