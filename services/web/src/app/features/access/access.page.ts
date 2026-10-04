import { ChangeDetectionStrategy, Component } from '@angular/core';

import { AccessStore } from './access.store';
import { DevicesPanel } from './devices-panel';
import { GroupsPanel } from './groups-panel';
import { InviteForm } from './invite-form';
import { InviteList } from './invite-list';

@Component({
  selector: 'mc-access-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InviteForm, InviteList, DevicesPanel, GroupsPanel],
  providers: [AccessStore],
  template: `
    <div class="flex flex-col gap-8">
      <header>
        <h1 class="t-display-lg">Convidados e acesso</h1>
        <p class="t-body-lg mt-2 text-text-muted">
          Convide amigos pela VPN, veja quem está conectado e revogue acessos.
        </p>
      </header>

      <div class="grid items-start gap-6 lg:grid-cols-2">
        <mc-invite-form />
        <mc-invite-list />
      </div>

      <mc-devices-panel />
      <mc-groups-panel />
    </div>
  `,
})
export class AccessPage {}
