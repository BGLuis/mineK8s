import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { InviteSummary, TailscaleApi } from '../../core/api';
import { McBanner, McButton, McPanel, McTextField, ToastService } from '../../ui';
import { apiErrorMessage } from '../join/api-error';
import { AccessStore } from './access.store';
import { copyToClipboard, focusFirstInvalid, formatShortDate } from './format';
import { INVITE_LIMITS, hasErrors, validateInvite } from './invite-form.logic';
import { ToggleChange, ToggleGroup } from './toggle-group';

@Component({
  selector: 'mc-invite-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, McPanel, McTextField, McButton, McBanner, ToggleGroup],
  template: `
    <mc-panel title="Novo convite">
      <form class="flex flex-col gap-4" novalidate (ngSubmit)="submit()">
        <mc-text-field
          label="Nome do convite"
          placeholder="Ex.: Amigos da escola"
          autocomplete="off"
          [maxlength]="limits.name.max"
          [errorText]="visible().name"
          [ngModel]="name()"
          (ngModelChange)="name.set($event)"
          [ngModelOptions]="{ standalone: true }"
        />
        <div class="grid grid-cols-2 gap-4">
          <mc-text-field
            label="Validade (dias)"
            inputmode="numeric"
            autocomplete="off"
            helpText="1 a 90"
            [errorText]="visible().days"
            [ngModel]="days()"
            (ngModelChange)="days.set($event)"
            [ngModelOptions]="{ standalone: true }"
          />
          <mc-text-field
            label="Máximo de usos"
            inputmode="numeric"
            autocomplete="off"
            helpText="1 a 500"
            [errorText]="visible().maxUses"
            [ngModel]="maxUses()"
            (ngModelChange)="maxUses.set($event)"
            [ngModelOptions]="{ standalone: true }"
          />
        </div>
        <mc-toggle-group
          label="Servidores liberados"
          emptyText="Nenhum servidor criado ainda."
          [options]="serverOptions()"
          [selected]="serverIds()"
          (toggled)="toggleId(serverIds, $event)"
        />
        @if (groupOptions().length > 0) {
          <mc-toggle-group
            label="Grupos"
            [options]="groupOptions()"
            [selected]="groupIds()"
            (toggled)="toggleId(groupIds, $event)"
          />
        }
        <p class="t-caption text-text-muted">
          Sem servidores nem grupos, a pessoa entra na rede mas não vê nenhum servidor.
        </p>
        @if (formError()) {
          <mc-banner tone="danger" title="Não foi possível gerar o convite">
            {{ formError() }}
          </mc-banner>
        }
        <mc-button type="submit" variant="primary" [block]="true" [disabled]="busy()">
          {{ busy() ? 'Gerando…' : 'Gerar convite' }}
        </mc-button>
      </form>

      @if (created(); as invite) {
        <div
          class="mt-4 border-2 border-dashed border-status-success bg-bg-sunken p-3"
          role="status"
        >
          <p class="t-caption mb-2 text-status-success">
            Convite criado · expira em {{ expiry(invite) }} · 0 de {{ invite.maxUses }} usos
          </p>
          <div class="flex items-center gap-2">
            <input
              class="t-body-md h-10 min-w-0 flex-1 bg-transparent text-text-primary outline-none"
              readonly
              aria-label="Link do convite"
              [value]="invite.joinUrl"
              (focus)="$any($event.target).select()"
            />
            <mc-button variant="info" size="sm" (click)="copy(invite)">Copiar link</mc-button>
          </div>
        </div>
      }
    </mc-panel>
  `,
})
export class InviteForm {
  private readonly store = inject(AccessStore);
  private readonly tailscale = inject(TailscaleApi);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly limits = INVITE_LIMITS;
  protected readonly name = signal('');
  protected readonly days = signal('7');
  protected readonly maxUses = signal('5');
  protected readonly serverIds = signal<readonly string[]>([]);
  protected readonly groupIds = signal<readonly string[]>([]);
  protected readonly busy = signal(false);
  protected readonly formError = signal('');
  protected readonly created = signal<InviteSummary | null>(null);
  private readonly submitted = signal(false);

  private readonly errors = computed(() =>
    validateInvite({ name: this.name(), days: this.days(), maxUses: this.maxUses() }),
  );
  /** Errors only appear after the first submit so the form does not scold while typing. */
  protected readonly visible = computed(() =>
    this.submitted() ? this.errors() : { name: '', days: '', maxUses: '' },
  );

  protected readonly serverOptions = computed(() =>
    (this.store.servers.value() ?? []).map((server) => ({ id: server.id, label: server.name })),
  );
  protected readonly groupOptions = computed(() =>
    (this.store.groups.value() ?? []).map((group) => ({ id: group.id, label: group.name })),
  );

  protected toggleId(target: WritableSignal<readonly string[]>, change: ToggleChange): void {
    target.update((ids) =>
      change.selected ? [...ids, change.id] : ids.filter((id) => id !== change.id),
    );
  }

  protected expiry(invite: InviteSummary): string {
    return formatShortDate(invite.expiresAt);
  }

  protected submit(): void {
    this.submitted.set(true);
    this.formError.set('');
    if (hasErrors(this.errors())) {
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    this.busy.set(true);
    this.tailscale
      .createInvite({
        name: this.name().trim(),
        expiresInDays: Number(this.days()),
        maxUses: Number(this.maxUses()),
        serverIds: [...this.serverIds()],
        groupIds: [...this.groupIds()],
      })
      .subscribe({
        next: (invite) => {
          this.busy.set(false);
          this.created.set(invite);
          this.store.invites.reload();
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.formError.set(apiErrorMessage(error, 'Tente de novo em instantes.'));
        },
      });
  }

  protected async copy(invite: InviteSummary): Promise<void> {
    if (await copyToClipboard(invite.joinUrl)) {
      this.toast.success('Link copiado.');
    } else {
      this.toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  }
}
