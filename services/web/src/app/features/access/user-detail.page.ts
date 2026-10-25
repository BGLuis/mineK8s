import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';

import {
  AccessChangeItem,
  AdminApi,
  DeviceStatus,
  Group,
  ServersApi,
  UserSummary,
  UserWorldAccess,
} from '../../core/api';
import {
  DialogService,
  McBanner,
  McButton,
  McIcon,
  McPanel,
  McStatusChip,
  McTable,
  StatusChipState,
  ToastService,
} from '../../ui';
import { apiErrorMessage } from '../join/api-error';
import { formatAccessReason } from './access-reason';
import { formatRelative } from './format';
import { buildAccessLossConfirmationMessage } from './simulate-confirm';
import { DEVICE_STATUS_VIEW, TONE_TEXT_CLASS } from './status-views';
import { ToggleChange, ToggleGroup, ToggleOption } from './toggle-group';

@Component({
  selector: 'mc-user-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, McButton, McIcon, McPanel, McTable, McStatusChip, McBanner, ToggleGroup],
  template: `
    <div class="flex flex-col gap-6">
      <div>
        <a
          routerLink="/access"
          class="inline-flex items-center gap-1.5 t-caption text-text-muted hover:text-text-primary transition-colors"
        >
          <mc-icon name="chevron-left" [size]="16" />
          Voltar para Convidados e acesso
        </a>
      </div>

      @if (users.error()) {
        <mc-banner tone="danger" title="Não foi possível carregar os dados do usuário">
          {{ errorText(users.error()) }}
          <div class="mt-2">
            <mc-button size="sm" (click)="users.reload()">Tentar de novo</mc-button>
          </div>
        </mc-banner>
      } @else if (user(); as u) {
        <header class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 class="t-display-lg">{{ u.minecraftNick }}</h1>
            <p class="t-body-md text-text-muted">
              {{ u.role === 'ADMIN' ? 'Administrador' : 'Jogador' }}
            </p>
          </div>
        </header>

        <!-- Perfil -->
        <mc-panel title="Perfil do jogador">
          <dl class="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <div>
              <dt class="t-caption text-text-muted">Nickname</dt>
              <dd class="t-body-strong">{{ u.minecraftNick }}</dd>
            </div>
            <div>
              <dt class="t-caption text-text-muted">Nome real</dt>
              <dd class="t-body-md">{{ u.realName || '—' }}</dd>
            </div>
            <div>
              <dt class="t-caption text-text-muted">E-mail</dt>
              <dd class="t-body-md">{{ u.email || '—' }}</dd>
            </div>
            <div>
              <dt class="t-caption text-text-muted">Usuário GitHub</dt>
              <dd class="t-body-md">{{ u.githubUsername ? '@' + u.githubUsername : '—' }}</dd>
            </div>
            <div>
              <dt class="t-caption text-text-muted">Status Tailscale</dt>
              <dd
                class="t-body-strong"
                [class.text-status-success]="u.linked"
                [class.text-status-warning]="!u.linked"
              >
                {{ u.linked ? 'Conta Tailscale ligada' : 'Aguardando o primeiro acesso' }}
              </dd>
            </div>
          </dl>
        </mc-panel>

        <!-- Dispositivos -->
        <mc-panel title="Dispositivos">
          @if (u.devices.length === 0) {
            <p class="t-body-md text-text-muted">Nenhum dispositivo registrado para este usuário.</p>
          } @else {
            <div class="overflow-x-auto bg-surface-default">
              <table mc-table class="w-full">
                <thead>
                  <tr>
                    <th scope="col">Dispositivo</th>
                    <th scope="col">Status</th>
                    <th scope="col">Último acesso</th>
                  </tr>
                </thead>
                <tbody>
                  @for (device of u.devices; track device.id) {
                    <tr>
                      <td class="t-body-strong">{{ device.deviceName || '—' }}</td>
                      <td>
                        <span [class]="deviceStatusClass(device.status)">
                          {{ deviceStatusLabel(device.status) }}
                        </span>
                      </td>
                      <td>{{ formatRelative(device.lastSeenAt) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </mc-panel>

        <!-- Grupos e Acesso Direto -->
        <div class="grid gap-6 md:grid-cols-2" [attr.aria-busy]="pending() !== null">
          <mc-panel title="Grupos de acesso">
            <mc-toggle-group
              label="Grupos atribuídos"
              emptyText="Nenhum grupo cadastrado."
              [options]="groupOptions()"
              [selected]="u.groupIds"
              (toggled)="toggleGroup($event)"
            />
          </mc-panel>

          <mc-panel title="Acesso direto a servidores">
            <mc-toggle-group
              label="Servidores liberados diretamente"
              emptyText="Nenhum servidor criado ainda."
              [options]="serverOptions()"
              [selected]="u.serverIds"
              (toggled)="toggleServer($event)"
            />
          </mc-panel>
        </div>

        <!-- Tabela de Avaliação de Acesso aos Mundos -->
        <mc-panel title="Acesso a todos os mundos">
          @if (access.error()) {
            <mc-banner tone="danger" title="Não foi possível carregar a matriz de acesso aos mundos">
              {{ errorText(access.error()) }}
              <div class="mt-2">
                <mc-button size="sm" (click)="access.reload()">Tentar de novo</mc-button>
              </div>
            </mc-banner>
          } @else if (access.value(); as worlds) {
            @if (worlds.length === 0) {
              <p class="t-body-md text-text-muted">Nenhum mundo cadastrado no sistema.</p>
            } @else {
              <div class="overflow-x-auto bg-surface-default">
                <table mc-table class="w-full">
                  <thead>
                    <tr>
                      <th scope="col">Mundo</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Acesso</th>
                      <th scope="col">Justificativa</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (world of worlds; track world.id) {
                      <tr>
                        <td>
                          <div class="min-w-0">
                            <p class="t-body-strong">{{ world.name }}</p>
                            <p class="t-caption text-text-muted">{{ world.subdomain }}</p>
                          </div>
                        </td>
                        <td>
                          <mc-status-chip [state]="chipState(world)" />
                        </td>
                        <td>
                          @if (world.allowed) {
                            <span class="inline-flex items-center gap-1 font-semibold text-status-success t-label-sm">
                              <mc-icon name="check" [size]="14" />
                              Permitido
                            </span>
                          } @else {
                            <span class="inline-flex items-center gap-1 font-semibold text-status-danger t-label-sm">
                              <mc-icon name="close" [size]="14" />
                              Negado
                            </span>
                          }
                        </td>
                        <td>
                          <span class="t-body-md">
                            {{ formatReason(world) }}
                          </span>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          } @else {
            <div class="flex flex-col gap-2" role="status" aria-label="Carregando mundos">
              @for (row of [0, 1, 2]; track row) {
                <div class="h-12 animate-pulse bg-surface-default"></div>
              }
            </div>
          }
        </mc-panel>
      } @else {
        <mc-banner tone="warning" title="Usuário não encontrado">
          O usuário solicitado não foi encontrado no sistema.
          <div class="mt-3">
            <a routerLink="/access" class="underline t-body-md">Voltar para a lista de acessos</a>
          </div>
        </mc-banner>
      }
    </div>
  `,
})
export class UserDetailPage {
  private readonly admin = inject(AdminApi);
  private readonly serversApi = inject(ServersApi);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);

  readonly id = input.required<string>();

  protected readonly users = rxResource({ stream: () => this.admin.listUsers() });
  protected readonly groups = rxResource({ stream: () => this.admin.listGroups() });
  protected readonly servers = rxResource({ stream: () => this.serversApi.list() });

  protected readonly access = rxResource<UserWorldAccess[], string>({
    stream: () => (this.id() ? this.admin.explainUserAccess(this.id()) : of([])),
  });

  protected readonly pending = signal<string | null>(null);

  protected readonly user = computed<UserSummary | null>(() => {
    const list = this.users.value() ?? [];
    return list.find((u) => u.id === this.id()) ?? null;
  });

  protected readonly groupOptions = computed<ToggleOption[]>(() =>
    (this.groups.value() ?? []).map((g) => ({ id: g.id, label: g.name })),
  );

  protected readonly serverOptions = computed<ToggleOption[]>(() =>
    (this.servers.value() ?? []).map((s) => ({ id: s.id, label: s.name })),
  );

  protected readonly groupNameMap = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const g of this.groups.value() ?? []) {
      map.set(g.id, g.name);
    }
    return map;
  });

  protected readonly serverNamesMap = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const s of this.servers.value() ?? []) {
      map.set(s.id, s.name);
    }
    return map;
  });

  protected formatRelative(date: string | null): string {
    return date ? formatRelative(date) : 'Nunca';
  }

  protected deviceStatusLabel(status: DeviceStatus): string {
    return DEVICE_STATUS_VIEW[status]?.label ?? status;
  }

  protected deviceStatusClass(status: DeviceStatus): string {
    const tone = DEVICE_STATUS_VIEW[status]?.tone ?? 'neutral';
    return TONE_TEXT_CLASS[tone];
  }

  protected chipState(world: UserWorldAccess): StatusChipState {
    if (world.is_maintenance) return 'MAINTENANCE';
    return (world.state as StatusChipState) || 'STOPPED';
  }

  protected formatReason(world: UserWorldAccess): string {
    return formatAccessReason(world, this.groupNameMap());
  }

  protected errorText(error: unknown): string {
    return apiErrorMessage(error, 'Ocorreu um erro ao carregar os dados.');
  }

  protected async toggleGroup(change: ToggleChange): Promise<void> {
    if (this.pending()) return;
    this.pending.set(change.id);

    const u = this.user();
    if (!u) {
      this.pending.set(null);
      return;
    }

    const changeItem: AccessChangeItem = change.selected
      ? { type: 'addUserToGroup', userId: u.id, groupId: change.id }
      : { type: 'removeUserFromGroup', userId: u.id, groupId: change.id };

    try {
      const simResults = await firstValueFrom(this.admin.simulateAccess([changeItem]));
      if (simResults.some((r) => r.losses.length > 0)) {
        const confirmed = await this.dialog.confirm({
          title: 'Confirmar alteração de acesso',
          message: buildAccessLossConfirmationMessage(
            simResults,
            (id) => this.serverNamesMap().get(id) ?? id,
          ),
          confirmLabel: 'Confirmar e aplicar',
          confirmVariant: 'danger',
        });
        if (!confirmed) {
          this.pending.set(null);
          return;
        }
      }

      if (change.selected) {
        this.admin.addUserToGroup(change.id, u.id).subscribe({
          next: () => {
            this.pending.set(null);
            this.toast.success('Grupo adicionado.');
            this.users.reload();
            this.access.reload();
          },
          error: (error: unknown) => {
            this.pending.set(null);
            this.toast.error(apiErrorMessage(error, 'Não foi possível alterar o grupo.'));
            this.users.reload();
            this.access.reload();
          },
        });
      } else {
        this.admin.removeUserFromGroup(change.id, u.id).subscribe({
          next: (res) => {
            this.pending.set(null);
            this.toast.success(
              res.kickedServers.length > 0
                ? `Pessoa removida e desconectada de ${res.kickedServers.length} servidor(es).`
                : 'Grupo removido.',
            );
            this.users.reload();
            this.access.reload();
          },
          error: (error: unknown) => {
            this.pending.set(null);
            this.toast.error(apiErrorMessage(error, 'Não foi possível alterar o grupo.'));
            this.users.reload();
            this.access.reload();
          },
        });
      }
    } catch (error: unknown) {
      this.pending.set(null);
      this.toast.error(apiErrorMessage(error, 'Não foi possível simular a alteração.'));
      this.users.reload();
      this.access.reload();
    }
  }

  protected async toggleServer(change: ToggleChange): Promise<void> {
    if (this.pending()) return;
    this.pending.set(change.id);

    const u = this.user();
    if (!u) {
      this.pending.set(null);
      return;
    }

    const changeItem: AccessChangeItem = change.selected
      ? { type: 'grantServer', userId: u.id, serverId: change.id }
      : { type: 'revokeServer', userId: u.id, serverId: change.id };

    try {
      const simResults = await firstValueFrom(this.admin.simulateAccess([changeItem]));
      if (simResults.some((r) => r.losses.length > 0)) {
        const confirmed = await this.dialog.confirm({
          title: 'Confirmar alteração de acesso',
          message: buildAccessLossConfirmationMessage(
            simResults,
            (id) => this.serverNamesMap().get(id) ?? id,
          ),
          confirmLabel: 'Confirmar e aplicar',
          confirmVariant: 'danger',
        });
        if (!confirmed) {
          this.pending.set(null);
          return;
        }
      }

      if (change.selected) {
        this.admin.grantUserServer(u.id, change.id).subscribe({
          next: () => {
            this.pending.set(null);
            this.toast.success('Acesso ao servidor concedido.');
            this.users.reload();
            this.access.reload();
          },
          error: (error: unknown) => {
            this.pending.set(null);
            this.toast.error(apiErrorMessage(error, 'Não foi possível alterar o acesso direto.'));
            this.users.reload();
            this.access.reload();
          },
        });
      } else {
        this.admin.revokeUserServer(u.id, change.id).subscribe({
          next: (res: { kickedServers: string[] }) => {
            this.pending.set(null);
            if (res.kickedServers && res.kickedServers.length > 0) {
              this.toast.success('Acesso revogado e jogador desconectado.');
            } else {
              this.toast.success('Acesso direto ao servidor revogado.');
            }
            this.users.reload();
            this.access.reload();
          },
          error: (error: unknown) => {
            this.pending.set(null);
            this.toast.error(apiErrorMessage(error, 'Não foi possível alterar o acesso direto.'));
            this.users.reload();
            this.access.reload();
          },
        });
      }
    } catch (error: unknown) {
      this.pending.set(null);
      this.toast.error(apiErrorMessage(error, 'Não foi possível simular a alteração.'));
      this.users.reload();
      this.access.reload();
    }
  }
}
