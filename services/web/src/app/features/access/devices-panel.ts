import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AccessibleServer, AdminApi, TailscaleApi, TailscaleDevice } from '../../core/api';
import {
  DialogService,
  McBanner,
  McButton,
  McDialog,
  McStatusChip,
  McTable,
  McTextField,
  ToastService,
} from '../../ui';
import { apiErrorMessage } from '../join/api-error';
import { AccessStore } from './access.store';
import { formatRelative } from './format';
import { isKickable, kickCandidates } from './kick-candidates';
import { DEVICE_STATUS_VIEW, TONE_TEXT_CLASS } from './status-views';

const INACTIVE_DAYS = 30;

@Component({
  selector: 'mc-devices-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, McBanner, McButton, McDialog, McStatusChip, McTable, McTextField],
  template: `
    <section aria-labelledby="devices-title">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h2 id="devices-title" class="t-title-md">Jogadores e dispositivos</h2>
        <mc-button size="sm" [disabled]="cleaning()" (click)="cleanInactive()">
          Limpar inativos ({{ inactiveDays }} dias)
        </mc-button>
      </div>

      @if (devices.error()) {
        <mc-banner tone="danger" title="Não foi possível carregar os dispositivos">
          {{ errorText() }}
          <div class="mt-2">
            <mc-button size="sm" (click)="devices.reload()">Tentar de novo</mc-button>
          </div>
        </mc-banner>
      } @else if (devices.value(); as list) {
        <div class="overflow-x-auto bg-surface-default">
          <table mc-table class="min-w-176">
            <caption class="sr-only">
              Jogadores e dispositivos conectados à rede
            </caption>
            <thead>
              <tr>
                <th scope="col">Jogador</th>
                <th scope="col">IP Tailscale</th>
                <th scope="col">Dispositivo</th>
                <th scope="col">VPN</th>
                <th scope="col">Último acesso</th>
                <th scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>
              @for (device of list; track device.id) {
                <tr>
                  <td class="t-body-strong">{{ nick(device) }}</td>
                  <td>{{ device.node_ip ?? '—' }}</td>
                  <td>{{ device.device_name ?? '—' }}</td>
                  <td>
                    <span [class]="statusClass(device)">{{ statusLabel(device) }}</span>
                  </td>
                  <td>{{ lastSeen(device) }}</td>
                  <td>
                    <div class="flex items-center gap-2">
                      @if (device.status === 'ACTIVE') {
                        <mc-button size="sm" (click)="openKick(device)">Expulsar</mc-button>
                        <mc-button size="sm" variant="danger" (click)="openBan(device)">
                          Banir da rede
                        </mc-button>
                      } @else if (device.status === 'PENDING') {
                        <mc-button size="sm" (click)="cancelPending(device)">Cancelar</mc-button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="text-text-muted">
                    Nenhum dispositivo na rede ainda. Gere um convite para o primeiro jogador.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="flex flex-col gap-2" role="status" aria-label="Carregando dispositivos">
          @for (row of skeleton; track row) {
            <div class="h-12 animate-pulse bg-surface-default"></div>
          }
        </div>
      }
      <p class="t-caption mt-3 text-text-muted">
        Expulsar = smart kick (desconecta do servidor, mantém a VPN). Banir da rede = remove o
        dispositivo do Tailscale e bloqueia novas conexões.
      </p>
    </section>

    <mc-dialog
      [(open)]="kickOpen"
      title="Expulsar jogador"
      confirmLabel="Expulsar"
      [confirmDisabled]="!kickServerId()"
      (confirmed)="confirmKick()"
    >
      @if (kickTarget(); as target) {
        <p class="mb-3">
          Desconecta <strong class="text-text-primary">{{ nick(target) }}</strong> do servidor
          escolhido. A VPN continua ativa e a pessoa pode voltar a entrar.
        </p>
        @if (!kickOptions().exact) {
          <p class="t-caption mb-3 text-status-warning">
            Não foi possível consultar os servidores dessa pessoa, então todos aparecem.
          </p>
        }
        <fieldset class="mb-3 min-w-0 border-0 p-0">
          <legend class="t-label-md mb-2 p-0 text-text-primary">Servidor</legend>
          <div class="flex flex-col gap-1">
            @for (server of kickOptions().servers; track server.id) {
              <label
                class="flex min-h-10 items-center gap-3 bg-surface-input px-3"
                [class.opacity-60]="!kickable(server)"
              >
                <input
                  type="radio"
                  name="kick-server"
                  class="size-4 accent-action-primary"
                  [value]="server.id"
                  [disabled]="!kickable(server)"
                  [checked]="kickServerId() === server.id"
                  (change)="kickServerId.set(server.id)"
                />
                <span class="min-w-0 flex-1 truncate text-text-primary">{{ server.name }}</span>
                <mc-status-chip [state]="server.state" />
              </label>
            } @empty {
              <p class="text-text-muted">
                {{ kickLoading() ? 'Carregando servidores…' : 'Essa pessoa não tem acesso a nenhum servidor.' }}
              </p>
            }
          </div>
          @if (kickOptions().servers.length > 0 && !hasKickable()) {
            <p class="t-caption mt-2 text-status-warning">
              Nenhum desses servidores está ligado, então não há ninguém para expulsar.
            </p>
          }
        </fieldset>
        <mc-text-field
          label="Motivo (opcional)"
          autocomplete="off"
          [ngModel]="kickReason()"
          (ngModelChange)="kickReason.set($event)"
          [ngModelOptions]="{ standalone: true }"
        />
      }
    </mc-dialog>

    <mc-dialog
      [(open)]="banOpen"
      title="Banir da rede"
      confirmLabel="Banir da rede"
      [confirmDisabled]="!banConfirmed()"
      (confirmed)="confirmBan()"
    >
      @if (banTarget(); as target) {
        <p class="mb-3">
          O dispositivo
          <strong class="text-text-primary">{{ target.device_name ?? 'sem nome' }}</strong> de
          <strong class="text-text-primary">{{ nick(target) }}</strong> será removido do Tailscale e
          novas conexões serão bloqueadas. Para voltar, a pessoa precisa de um novo convite.
        </p>
        <mc-text-field
          [label]="'Digite ' + banKey(target) + ' para confirmar'"
          autocomplete="off"
          [ngModel]="banTyped()"
          (ngModelChange)="banTyped.set($event)"
          [ngModelOptions]="{ standalone: true }"
        />
      }
    </mc-dialog>
  `,
})
export class DevicesPanel {
  private readonly store = inject(AccessStore);
  private readonly tailscale = inject(TailscaleApi);
  private readonly admin = inject(AdminApi);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);

  protected readonly devices = this.store.devices;
  protected readonly inactiveDays = INACTIVE_DAYS;
  protected readonly skeleton = [0, 1, 2, 3];
  protected readonly cleaning = signal(false);

  protected readonly kickOpen = signal(false);
  protected readonly kickTarget = signal<TailscaleDevice | null>(null);
  protected readonly kickServerId = signal('');
  protected readonly kickReason = signal('');
  /** null until the request answers; 'error' when it failed. */
  private readonly kickAccessible = signal<AccessibleServer[] | 'error' | null>(null);
  protected readonly kickLoading = computed(() => this.kickAccessible() === null);
  protected readonly kickOptions = computed(() => {
    const accessible = this.kickAccessible();
    if (accessible === null) {
      return { servers: [], exact: true };
    }
    return kickCandidates(
      accessible === 'error' ? null : accessible,
      this.store.servers.value() ?? [],
    );
  });
  protected readonly hasKickable = computed(() => this.kickOptions().servers.some(isKickable));

  protected readonly banOpen = signal(false);
  protected readonly banTarget = signal<TailscaleDevice | null>(null);
  protected readonly banTyped = signal('');
  protected readonly banConfirmed = computed(() => {
    const target = this.banTarget();
    return !!target && this.banTyped().trim() === this.banKey(target);
  });

  protected readonly kickable = isKickable;

  protected errorText(): string {
    return apiErrorMessage(this.devices.error(), 'Tente de novo em instantes.');
  }

  protected nick(device: TailscaleDevice): string {
    return device.user?.minecraft_nick ?? '—';
  }

  /** The text the admin must type to confirm a ban; falls back for devices without a linked user. */
  protected banKey(device: TailscaleDevice): string {
    return device.user?.minecraft_nick ?? 'BANIR';
  }

  protected statusLabel(device: TailscaleDevice): string {
    return DEVICE_STATUS_VIEW[device.status].label;
  }

  protected statusClass(device: TailscaleDevice): string {
    return TONE_TEXT_CLASS[DEVICE_STATUS_VIEW[device.status].tone];
  }

  protected lastSeen(device: TailscaleDevice): string {
    return formatRelative(device.last_seen_at);
  }

  protected openKick(device: TailscaleDevice): void {
    this.kickTarget.set(device);
    this.kickServerId.set('');
    this.kickReason.set('');
    this.kickAccessible.set(null);
    this.kickOpen.set(true);
    this.admin.listAccessibleServers(device.user_id).subscribe({
      next: (servers) => this.kickAccessible.set(servers),
      error: () => this.kickAccessible.set('error'),
    });
  }

  protected confirmKick(): void {
    const target = this.kickTarget();
    const server = this.kickOptions().servers.find((item) => item.id === this.kickServerId());
    if (!target || !server) {
      return;
    }
    const nick = this.nick(target);
    const reason = this.kickReason().trim();
    this.admin
      .smartKick({
        serverId: server.id,
        minecraftNick: nick,
        ...(reason ? { reason } : {}),
      })
      .subscribe({
        next: () =>
          this.toast.success(`${nick} foi expulso de ${server.name}. A VPN continua ativa.`),
        error: (error: unknown) =>
          this.toast.error(apiErrorMessage(error, `Não foi possível expulsar ${nick}.`)),
      });
  }

  protected openBan(device: TailscaleDevice): void {
    this.banTarget.set(device);
    this.banTyped.set('');
    this.banOpen.set(true);
  }

  protected confirmBan(): void {
    const target = this.banTarget();
    if (target) {
      this.revoke(target, `${this.nick(target)} foi banido da rede.`);
    }
  }

  protected async cancelPending(device: TailscaleDevice): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Cancelar acesso pendente',
      message: `Remove o dispositivo pendente de ${this.nick(device)}. Se a pessoa ainda quiser entrar, vai precisar de um novo convite.`,
      confirmLabel: 'Cancelar acesso',
    });
    if (confirmed) {
      this.revoke(device, `Acesso pendente de ${this.nick(device)} cancelado.`);
    }
  }

  protected async cleanInactive(): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Limpar dispositivos inativos',
      message: `Remove da rede os dispositivos sem acesso há ${INACTIVE_DAYS} dias. Quem voltar a jogar precisará de um novo convite.`,
      confirmLabel: 'Limpar inativos',
    });
    if (!confirmed) {
      return;
    }
    this.cleaning.set(true);
    this.tailscale.collectGarbage(INACTIVE_DAYS).subscribe({
      next: ({ removedCount }) => {
        this.cleaning.set(false);
        this.toast.success(
          removedCount === 0
            ? 'Nenhum dispositivo inativo para remover.'
            : `${removedCount} ${removedCount === 1 ? 'dispositivo removido' : 'dispositivos removidos'}.`,
        );
        this.devices.reload();
      },
      error: (error: unknown) => {
        this.cleaning.set(false);
        this.toast.error(apiErrorMessage(error, 'Não foi possível limpar os dispositivos.'));
      },
    });
  }

  private revoke(device: TailscaleDevice, successMessage: string): void {
    this.tailscale.revokeDevice(device.id).subscribe({
      next: () => {
        this.toast.success(successMessage);
        this.devices.reload();
      },
      error: (error: unknown) =>
        this.toast.error(apiErrorMessage(error, 'Não foi possível revogar o dispositivo.')),
    });
  }
}
