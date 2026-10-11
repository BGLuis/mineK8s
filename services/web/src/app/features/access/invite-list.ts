import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { InviteSummary, TailscaleApi } from '../../core/api';
import { DialogService, McBanner, McButton, McPanel, ToastService } from '../../ui';
import { apiErrorMessage } from '../join/api-error';
import { AccessStore } from './access.store';
import { copyToClipboard } from './format';
import {
  INVITE_STATUS_VIEW,
  TONE_TEXT_CLASS,
  inviteUsageText,
  isInviteActionable,
} from './status-views';

@Component({
  selector: 'mc-invite-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McPanel, McButton, McBanner],
  template: `
    <mc-panel title="Convites">
      @if (invites.error()) {
        <mc-banner tone="danger" title="Não foi possível carregar os convites">
          {{ errorText() }}
          <div class="mt-2">
            <mc-button size="sm" (click)="invites.reload()">Tentar de novo</mc-button>
          </div>
        </mc-banner>
      } @else if (invites.value(); as list) {
        @if (list.length === 0) {
          <p class="t-body-md text-text-muted">
            Nenhum convite ainda. Os que você gerar aparecem aqui.
          </p>
        } @else {
          <ul class="flex flex-col">
            @for (invite of list; track invite.id) {
              <li
                class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b-2 border-border-strong py-3"
              >
                <div class="min-w-0">
                  <p class="t-body-strong truncate">{{ invite.name }}</p>
                  <p class="t-caption text-text-muted">{{ usage(invite) }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <span class="t-caption uppercase" [class]="toneClass(invite)">{{
                    statusLabel(invite)
                  }}</span>
                  @if (actionable(invite)) {
                    <mc-button size="sm" (click)="copy(invite)">Copiar</mc-button>
                    <mc-button
                      size="sm"
                      variant="danger"
                      [disabled]="revoking() === invite.id"
                      (click)="revoke(invite)"
                    >
                      Revogar
                    </mc-button>
                  }
                </div>
              </li>
            }
          </ul>
        }
      } @else {
        <div class="flex flex-col gap-3" role="status" aria-label="Carregando convites">
          @for (row of skeleton; track row) {
            <div class="h-12 animate-pulse bg-surface-hover"></div>
          }
        </div>
      }
    </mc-panel>
  `,
})
export class InviteList {
  private readonly store = inject(AccessStore);
  private readonly tailscale = inject(TailscaleApi);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);

  protected readonly invites = this.store.invites;
  protected readonly skeleton = [0, 1, 2];
  protected readonly revoking = signal<string | null>(null);

  protected errorText(): string {
    return apiErrorMessage(this.invites.error(), 'Tente de novo em instantes.');
  }

  protected usage(invite: InviteSummary): string {
    return inviteUsageText(invite);
  }

  protected statusLabel(invite: InviteSummary): string {
    return INVITE_STATUS_VIEW[invite.status].label;
  }

  protected toneClass(invite: InviteSummary): string {
    return TONE_TEXT_CLASS[INVITE_STATUS_VIEW[invite.status].tone];
  }

  protected actionable(invite: InviteSummary): boolean {
    return isInviteActionable(invite.status);
  }

  protected async copy(invite: InviteSummary): Promise<void> {
    if (await copyToClipboard(invite.joinUrl)) {
      this.toast.success(`Link de "${invite.name}" copiado.`);
    } else {
      this.toast.error('Não foi possível copiar o link.');
    }
  }

  protected async revoke(invite: InviteSummary): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Revogar convite',
      message: `O link de "${invite.name}" deixa de funcionar. Quem já entrou na rede continua com acesso.`,
      confirmLabel: 'Revogar convite',
    });
    if (!confirmed) {
      return;
    }
    this.revoking.set(invite.id);
    this.tailscale.revokeInvite(invite.id).subscribe({
      next: () => {
        this.revoking.set(null);
        this.toast.success(`Convite "${invite.name}" revogado.`);
        this.invites.reload();
      },
      error: (error: unknown) => {
        this.revoking.set(null);
        this.toast.error(apiErrorMessage(error, 'Não foi possível revogar o convite.'));
      },
    });
  }
}
