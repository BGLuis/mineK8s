import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { SharedPlayerSummary, TailscaleApi, UnlinkedAttempt, UserSummary } from '../../core/api';
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
        A pessoa usa a própria conta do Tailscale. Cadastre o e-mail ou o usuário do GitHub dela aqui
        e depois compartilhe o nó do gateway com essa conta no console do Tailscale.
      </p>
      <form class="flex flex-col gap-4" novalidate (ngSubmit)="submit()">
        <div class="grid gap-4 md:grid-cols-3">
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
            label="Usuário do GitHub"
            autocomplete="off"
            placeholder="amigo ou @amigo"
            helpText="Com ou sem @"
            [errorText]="visible().github"
            [ngModel]="github()"
            (ngModelChange)="github.set($event)"
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
        @if (visible().identity) {
          <p class="t-caption -mt-2 text-status-danger">
            {{ visible().identity }}
          </p>
        }
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
            {{ player.minecraftNick }} cadastrado. Compartilhe o nó do gateway com
            <strong>{{ player.email || ('@' + player.githubUsername) }}</strong> no console do Tailscale. No primeiro acesso da pessoa a
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
                <p class="t-caption truncate text-text-muted">
                  @if (player.email && player.githubUsername) {
                    {{ player.email }} • &#64;{{ player.githubUsername }}
                  } @else if (player.githubUsername) {
                    &#64;{{ player.githubUsername }} (GitHub)
                  } @else {
                    {{ player.email }}
                  }
                </p>
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

      @if (unlinkedAttempts().length > 0) {
        <div class="mt-8 border-t border-border-default pt-6">
          <div class="mb-3 flex items-center justify-between">
            <div>
              <h3 class="t-title-md">Tentativas de conexão recentes não vinculadas</h3>
              <p class="t-caption text-text-muted">
                Contas Tailscale que tentaram entrar no gateway mas ainda não foram associadas a um jogador.
              </p>
            </div>
            <mc-button
              size="sm"
              variant="neutral"
              (click)="store.unlinkedAttempts.reload()"
            >
              Atualizar
            </mc-button>
          </div>

          <ul class="flex flex-col gap-3" aria-label="Tentativas não vinculadas">
            @for (attempt of unlinkedAttempts(); track attempt.tailscaleUserId || attempt.clientIp) {
              <li class="bevel-panel flex flex-col gap-3 bg-surface-default p-3 md:flex-row md:items-center md:justify-between">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="t-label-md font-bold text-text-primary">
                      {{ attempt.minecraftNick || 'Nick desconhecido' }}
                    </span>
                    <span class="t-caption rounded bg-surface-sunken px-1.5 py-0.5 text-text-muted">
                      {{ attempt.loginName }}
                    </span>
                  </div>
                  <p class="t-caption mt-1 text-text-muted">
                    IP: {{ attempt.clientIp }}
                    @if (attempt.nodeName) {
                      • Dispositivo: {{ attempt.nodeName }}
                    }
                    • {{ formatAttemptTime(attempt.attemptedAt) }}
                  </p>
                </div>

                <div class="flex items-center gap-2">
                  <select
                    class="bevel-sunken t-body-md h-9 bg-surface-input px-2 text-text-primary"
                    [value]="getSelectedUserId(attempt)"
                    (change)="onSelectUser(attempt.tailscaleUserId, $event)"
                  >
                    <option value="" disabled selected>Vincular a…</option>
                    @for (candidate of unlinkedCandidates(); track candidate.id) {
                      <option [value]="candidate.id">
                        {{ candidate.minecraftNick }} ({{ candidate.email || ('@' + candidate.githubUsername) || 'Sem ID' }})
                      </option>
                    }
                  </select>

                  <mc-button
                    size="sm"
                    variant="primary"
                    [disabled]="!getSelectedUserId(attempt) || linkingAttemptId() === attempt.tailscaleUserId"
                    (click)="linkAttempt(attempt)"
                  >
                    {{ linkingAttemptId() === attempt.tailscaleUserId ? 'Vinculando…' : 'Vincular' }}
                  </mc-button>

                  <mc-button
                    size="sm"
                    variant="neutral"
                    icon="close"
                    [ariaLabel]="'Ignorar tentativa de ' + attempt.loginName"
                    (click)="dismissAttempt(attempt)"
                  />
                </div>
              </li>
            }
          </ul>
        </div>
      }
    </mc-panel>
  `,
})
export class SharedPlayersPanel {
  protected readonly store = inject(AccessStore);
  private readonly tailscale = inject(TailscaleApi);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);

  protected readonly email = signal('');
  protected readonly github = signal('');
  protected readonly nick = signal('');
  protected readonly serverIds = signal<readonly string[]>([]);
  protected readonly groupIds = signal<readonly string[]>([]);
  protected readonly busy = signal(false);
  protected readonly formError = signal('');
  protected readonly created = signal<SharedPlayerSummary | null>(null);
  protected readonly linkingAttemptId = signal('');
  protected readonly selectedUserForAttempt = signal<Record<string, string>>({});
  private readonly submitted = signal(false);

  private readonly errors = computed(() =>
    validateSharedPlayer({ email: this.email(), github: this.github(), nick: this.nick() }),
  );
  /** Errors only appear after the first submit so the form does not scold while typing. */
  protected readonly visible = computed(() =>
    this.submitted() ? this.errors() : { identity: '', email: '', github: '', nick: '' },
  );

  protected readonly serverOptions = computed(() =>
    (this.store.servers.value() ?? []).map((server) => ({ id: server.id, label: server.name })),
  );
  protected readonly groupOptions = computed(() =>
    (this.store.groups.value() ?? []).map((group) => ({ id: group.id, label: group.name })),
  );
  protected readonly players = computed<UserSummary[]>(() =>
    (this.store.users.value() ?? []).filter(
      (user) => user.role === 'PLAYER' && (!!user.email || !!user.githubUsername),
    ),
  );
  protected readonly unlinkedCandidates = computed<UserSummary[]>(() =>
    (this.store.users.value() ?? []).filter((user) => user.role === 'PLAYER'),
  );
  protected readonly unlinkedAttempts = computed<UnlinkedAttempt[]>(
    () => this.store.unlinkedAttempts.value() ?? [],
  );

  protected getSelectedUserId(attempt: UnlinkedAttempt): string {
    const manual = this.selectedUserForAttempt()[attempt.tailscaleUserId];
    if (manual) {
      return manual;
    }
    if (attempt.minecraftNick) {
      const match = this.unlinkedCandidates().find(
        (u) => !u.linked && u.minecraftNick.toLowerCase() === attempt.minecraftNick.toLowerCase(),
      );
      if (match) {
        return match.id;
      }
    }
    return '';
  }

  protected onSelectUser(tailscaleUserId: string, event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.selectedUserForAttempt.update((prev) => ({
      ...prev,
      [tailscaleUserId]: target.value,
    }));
  }

  protected linkAttempt(attempt: UnlinkedAttempt): void {
    const userId = this.getSelectedUserId(attempt);
    if (!userId) {
      return;
    }
    this.linkingAttemptId.set(attempt.tailscaleUserId);
    const ghUser = attempt.loginName.endsWith('@github')
      ? attempt.loginName.replace(/@github$/, '')
      : undefined;

    this.tailscale
      .linkSharedPlayer({
        userId,
        tailscaleUserId: attempt.tailscaleUserId,
        githubUsername: ghUser,
      })
      .subscribe({
        next: (player) => {
          this.linkingAttemptId.set('');
          this.toast.success(`${player.minecraftNick} vinculado com sucesso!`);
          this.store.users.reload();
          this.store.unlinkedAttempts.reload();
        },
        error: (error: unknown) => {
          this.linkingAttemptId.set('');
          this.toast.error(apiErrorMessage(error, 'Não foi possível vincular o jogador.'));
        },
      });
  }

  protected dismissAttempt(attempt: UnlinkedAttempt): void {
    this.tailscale.dismissUnlinkedAttempt(attempt.tailscaleUserId).subscribe({
      next: () => {
        this.store.unlinkedAttempts.reload();
      },
      error: (error: unknown) => {
        this.toast.error(apiErrorMessage(error, 'Não foi possível dispensar a tentativa.'));
      },
    });
  }

  protected formatAttemptTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  }

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
    const emailVal = this.email().trim();
    const githubVal = this.github().trim();

    this.tailscale
      .registerSharedPlayer({
        email: emailVal || undefined,
        github: githubVal || undefined,
        minecraftNick: this.nick().trim(),
        serverIds: [...this.serverIds()],
        groupIds: [...this.groupIds()],
      })
      .subscribe({
        next: (player) => {
          this.busy.set(false);
          this.created.set(player);
          this.email.set('');
          this.github.set('');
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
