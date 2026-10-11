import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { SharedPlayerSummary, TailscaleApi, UserSummary } from '../../core/api';
import { DialogService, McBanner, McButton, McPanel, McTextField, ToastService } from '../../ui';
import { apiErrorMessage } from '../join/api-error';
import { AccessStore } from './access.store';
import { hasSharedPlayerErrors, validateSharedPlayer } from './shared-player.logic';
import { ToggleChange, ToggleGroup } from './toggle-group';

@Component({
  selector: 'mc-shared-players-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, McBanner, McButton, McPanel, McTextField, ToggleGroup],
  template: `
    <mc-panel title="Jogadores por compartilhamento de nó">
      <p class="t-body-md mb-4 text-text-muted">
        A pessoa usa a própria conta do Tailscale. Cadastre o e-mail dela aqui e depois compartilhe o
        nó do gateway com esse e-mail no console do Tailscale.
      </p>
      <form class="flex flex-col gap-4" novalidate (ngSubmit)="submit()">
        <div class="grid gap-4 md:grid-cols-2">
          <mc-text-field
            label="E-mail da conta Tailscale"
            inputmode="email"
            autocomplete="off"
            placeholder="amigo@exemplo.com"
            [errorText]="visible().email"
            [ngModel]="email()"
            (ngModelChange)="email.set($event)"
            [ngModelOptions]="{ standalone: true }"
          />
          <mc-text-field
            label="Nickname no Minecraft"
            autocomplete="off"
            helpText="3 a 16 letras, números ou _"
            [maxlength]="16"
            [errorText]="visible().nick"
            [ngModel]="nick()"
            (ngModelChange)="nick.set($event)"
            [ngModelOptions]="{ standalone: true }"
          />
        </div>
        @if (serverOptions().length > 0) {
          <mc-toggle-group
            label="Servidores liberados"
            [options]="serverOptions()"
            [selected]="serverIds()"
            (toggled)="toggle(serverIds, $event)"
          />
        }
        @if (groupOptions().length > 0) {
          <mc-toggle-group
            label="Grupos"
            [options]="groupOptions()"
            [selected]="groupIds()"
            (toggled)="toggle(groupIds, $event)"
          />
        }
        @if (formError()) {
          <mc-banner tone="danger" title="Não foi possível cadastrar">
            {{ formError() }}
          </mc-banner>
        }
        <mc-button type="submit" variant="primary" [block]="true" [disabled]="busy()">
          {{ busy() ? 'Cadastrando…' : 'Cadastrar jogador' }}
        </mc-button>
      </form>

      @if (created(); as player) {
        <div class="mt-4 border-2 border-dashed border-status-success bg-bg-sunken p-3" role="status">
          <p class="t-caption text-status-success">
            {{ player.minecraftNick }} cadastrado. Falta compartilhar o nó do gateway com
            <strong>{{ player.email }}</strong> no console do Tailscale. No primeiro acesso da pessoa a
            conta é ligada ao cadastro.
          </p>
        </div>
      }

      @if (players().length > 0) {
        <ul class="mt-6 flex flex-col gap-3" aria-label="Jogadores cadastrados">
          @for (player of players(); track player.id) {
            <li class="bevel-panel flex items-center justify-between gap-3 bg-surface-default p-3">
              <div class="min-w-0">
                <p class="t-label-md truncate">{{ player.minecraftNick }}</p>
                <p class="t-caption truncate text-text-muted">{{ player.email }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-3">
                <span
                  class="t-caption"
                  [class.text-status-success]="player.linked"
                  [class.text-status-warning]="!player.linked"
                >
                  {{ player.linked ? 'Conta ligada' : 'Aguardando o primeiro acesso' }}
                </span>
                <mc-button
                  size="sm"
                  variant="danger"
                  icon="trash"
                  [ariaLabel]="'Remover ' + player.minecraftNick"
                  (click)="remove(player)"
                />
              </div>
            </li>
          }
        </ul>
      }
    </mc-panel>
  `,
})
export class SharedPlayersPanel {
  private readonly store = inject(AccessStore);
  private readonly tailscale = inject(TailscaleApi);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);

  protected readonly email = signal('');
  protected readonly nick = signal('');
  protected readonly serverIds = signal<readonly string[]>([]);
  protected readonly groupIds = signal<readonly string[]>([]);
  protected readonly busy = signal(false);
  protected readonly formError = signal('');
  protected readonly created = signal<SharedPlayerSummary | null>(null);
  private readonly submitted = signal(false);

  private readonly errors = computed(() =>
    validateSharedPlayer({ email: this.email(), nick: this.nick() }),
  );
  /** Errors only appear after the first submit so the form does not scold while typing. */
  protected readonly visible = computed(() =>
    this.submitted() ? this.errors() : { email: '', nick: '' },
  );

  protected readonly serverOptions = computed(() =>
    (this.store.servers.value() ?? []).map((server) => ({ id: server.id, label: server.name })),
  );
  protected readonly groupOptions = computed(() =>
    (this.store.groups.value() ?? []).map((group) => ({ id: group.id, label: group.name })),
  );
  protected readonly players = computed<UserSummary[]>(() =>
    (this.store.users.value() ?? []).filter((user) => user.role === 'PLAYER' && !!user.email),
  );

  protected toggle(
    target: { update: (fn: (ids: readonly string[]) => readonly string[]) => void },
    change: ToggleChange,
  ): void {
    target.update((ids) =>
      change.selected ? [...ids, change.id] : ids.filter((id) => id !== change.id),
    );
  }

  protected submit(): void {
    this.submitted.set(true);
    this.formError.set('');
    if (hasSharedPlayerErrors(this.errors())) {
      return;
    }
    this.busy.set(true);
    this.tailscale
      .registerSharedPlayer({
        email: this.email().trim(),
        minecraftNick: this.nick().trim(),
        serverIds: [...this.serverIds()],
        groupIds: [...this.groupIds()],
      })
      .subscribe({
        next: (player) => {
          this.busy.set(false);
          this.created.set(player);
          this.email.set('');
          this.nick.set('');
          this.submitted.set(false);
          this.store.users.reload();
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.formError.set(apiErrorMessage(error, 'Tente de novo em instantes.'));
        },
      });
  }

  protected async remove(player: UserSummary): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Remover jogador',
      message: `${player.minecraftNick} será desconectado e perde o acesso. Para encerrar o compartilhamento, descompartilhe o nó no console do Tailscale.`,
      confirmLabel: 'Remover jogador',
    });
    if (!confirmed) {
      return;
    }
    this.tailscale.removeSharedPlayer(player.id).subscribe({
      next: () => {
        this.toast.success(`${player.minecraftNick} removido.`);
        this.store.users.reload();
      },
      error: (error: unknown) =>
        this.toast.error(apiErrorMessage(error, 'Não foi possível remover o jogador.')),
    });
  }
}
