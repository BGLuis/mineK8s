import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { McBanner } from '../../ui';
import { AccessStore } from './access.store';
import { DevicesPanel } from './devices-panel';
import { GroupsPanel } from './groups-panel';
import { InviteForm } from './invite-form';
import { InviteList } from './invite-list';

@Component({
  selector: 'mc-access-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InviteForm, InviteList, DevicesPanel, GroupsPanel, McBanner, RouterLink],
  providers: [AccessStore],
  template: `
    <div class="flex flex-col gap-8">
      <header>
        <h1 class="t-display-lg">Convidados e acesso</h1>
        <p class="t-body-lg mt-2 text-text-muted">
          Convide amigos pela VPN, veja quem está conectado e revogue acessos.
        </p>
      </header>

      @if (store.keyInvitesEnabled() === false) {
        <mc-banner tone="info" title="Convites com chave de acesso desativados">
          Os apps do Tailscale com interface não aceitam chave de acesso, então não dá para criar
          convites novos. Os convites antigos continuam na lista para você revogar. Para reativar,
          abra as <a class="underline" routerLink="/settings">Configurações</a>.
        </mc-banner>
      }

      <div
        class="grid items-start gap-6"
        [class.lg:grid-cols-2]="store.keyInvitesEnabled() === true"
      >
        @if (store.keyInvitesEnabled() === true) {
          <mc-invite-form />
        }
        <mc-invite-list />
      </div>

      <mc-devices-panel />
      <mc-groups-panel />
    </div>
  `,
})
export class AccessPage {
  protected readonly store = inject(AccessStore);
}
