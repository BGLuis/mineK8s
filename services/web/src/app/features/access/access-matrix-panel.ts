import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';

import { AccessMatrixCell, AccessMatrixServer, AccessMatrixUser, AdminApi } from '../../core/api';
import { McBanner, McButton, McIcon, McSelect, McTable, SelectOption } from '../../ui';
import { apiErrorMessage } from '../join/api-error';
import { formatAccessReason } from './access-reason';
import { AccessStore } from './access.store';

@Component({
  selector: 'mc-access-matrix-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, McBanner, McButton, McIcon, McSelect, McTable],
  template: `
    <section aria-labelledby="matrix-title">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="matrix-title" class="t-title-md">Matriz de acesso</h2>
          <p class="t-body-md text-text-muted mt-1">
            Visão consolidada de quais jogadores têm permissão em cada mundo.
          </p>
        </div>
      </div>

      @if (matrix.error()) {
        <mc-banner tone="danger" title="Não foi possível carregar a matriz de acesso">
          {{ errorText() }}
          <div class="mt-2">
            <mc-button size="sm" (click)="matrix.reload()">Tentar de novo</mc-button>
          </div>
        </mc-banner>
      } @else if (matrix.value(); as data) {
        <!-- Filtros -->
        <div class="mb-4 flex flex-wrap items-center gap-4">
          <div class="w-full sm:w-56">
            <mc-select
              label="Filtrar por grupo"
              [options]="groupOptions()"
              [value]="selectedGroupId()"
              (valueChange)="selectedGroupId.set($event)"
            />
          </div>
          <div class="w-full sm:w-56">
            <mc-select
              label="Filtrar por mundo"
              [options]="serverOptions()"
              [value]="selectedServerId()"
              (valueChange)="selectedServerId.set($event)"
            />
          </div>
        </div>

        <!-- Barra de resumo de Administradores -->
        @if (adminUsers().length > 0) {
          <div
            class="mb-4 flex flex-wrap items-center gap-2 rounded bg-surface-raised p-3 border border-border-default"
            role="region"
            aria-label="Administradores com acesso irrestrito"
          >
            <span class="t-label-sm font-semibold text-text-primary">Administradores:</span>
            <span class="t-body-sm text-text-muted">Acesso a todos os mundos:</span>
            <div class="flex flex-wrap items-center gap-2">
              @for (admin of adminUsers(); track admin.id) {
                <a
                  [routerLink]="['/access/users', admin.id]"
                  class="t-label-sm font-semibold text-action-primary hover:underline"
                >
                  {{ admin.minecraftNick }}
                </a>
              }
            </div>
          </div>
        }

        <!-- Tabela da Matriz -->
        <div class="overflow-x-auto bg-surface-default">
          <table mc-table class="min-w-full">
            <caption class="sr-only">
              Matriz de permissões de acesso por jogador e servidor
            </caption>
            <thead>
              <tr>
                <th scope="col" class="min-w-44">Jogador</th>
                @for (server of filteredServers(); track server.id) {
                  <th scope="col" class="text-center">
                    <div>{{ server.name }}</div>
                    <div class="t-caption font-normal text-text-muted">{{ server.subdomain }}</div>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @if (filteredPlayers().length === 0) {
                <tr>
                  <td
                    [attr.colspan]="filteredServers().length + 1"
                    class="text-center py-6 text-text-muted t-body-md"
                  >
                    Nenhum jogador encontrado com os filtros selecionados.
                  </td>
                </tr>
              } @else {
                @for (player of filteredPlayers(); track player.id) {
                  <tr>
                    <td>
                      <a
                        [routerLink]="['/access/users', player.id]"
                        class="font-semibold text-action-primary hover:underline"
                      >
                        {{ player.minecraftNick }}
                      </a>
                      @if (player.realName) {
                        <div class="t-caption text-text-muted">{{ player.realName }}</div>
                      }
                    </td>
                    @for (server of filteredServers(); track server.id) {
                      @let cell = getCell(player.id, server.id);
                      @let reason = getCellReason(cell);
                      @let cellLabel = getCellLabel(cell);
                      <td class="text-center">
                        <span
                          class="inline-flex items-center justify-center gap-1 rounded px-2 py-1 text-center t-label-sm"
                          [class.text-status-success]="cell?.allowed"
                          [class.text-status-danger]="!cell?.allowed"
                          [attr.aria-label]="cellLabel"
                          [title]="reason"
                        >
                          <mc-icon [name]="cell?.allowed ? 'check' : 'close'" [size]="14" />
                          <span>{{ cell?.allowed ? 'Permitido' : 'Negado' }}</span>
                          <span class="sr-only">({{ reason }})</span>
                        </span>
                      </td>
                    }
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="flex flex-col gap-2" role="status" aria-label="Carregando matriz de acesso">
          @for (row of [0, 1, 2]; track row) {
            <div class="h-12 animate-pulse bg-surface-default"></div>
          }
        </div>
      }
    </section>
  `,
})
export class AccessMatrixPanel {
  private readonly admin = inject(AdminApi);
  private readonly store = inject(AccessStore, { optional: true });

  protected readonly matrix = rxResource({ stream: () => this.admin.getAccessMatrix() });

  readonly selectedGroupId = signal<string>('all');
  readonly selectedServerId = signal<string>('all');

  protected readonly groupOptions = computed<readonly SelectOption[]>(() => {
    const groups = this.store?.groups.value() ?? [];
    return [
      { value: 'all', label: 'Todos os grupos' },
      ...groups.map((g) => ({ value: g.id, label: g.name })),
    ];
  });

  protected readonly serverOptions = computed<readonly SelectOption[]>(() => {
    const servers = this.matrix.value()?.servers ?? [];
    return [
      { value: 'all', label: 'Todos os mundos' },
      ...servers.map((s) => ({ value: s.id, label: s.name })),
    ];
  });

  protected readonly groupNameById = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    const groups = this.store?.groups.value() ?? [];
    for (const g of groups) {
      map.set(g.id, g.name);
    }
    return map;
  });

  protected readonly adminUsers = computed<AccessMatrixUser[]>(() => {
    return (this.matrix.value()?.users ?? []).filter((u) => u.role === 'ADMIN');
  });

  protected readonly filteredPlayers = computed<AccessMatrixUser[]>(() => {
    const players = (this.matrix.value()?.users ?? []).filter((u) => u.role === 'PLAYER');
    const gid = this.selectedGroupId();
    if (gid === 'all') return players;
    return players.filter((p) => p.groupIds.includes(gid));
  });

  protected readonly filteredServers = computed<AccessMatrixServer[]>(() => {
    const servers = this.matrix.value()?.servers ?? [];
    const sid = this.selectedServerId();
    if (sid === 'all') return servers;
    return servers.filter((s) => s.id === sid);
  });

  getCell(userId: string, serverId: string): AccessMatrixCell | undefined {
    return this.matrix.value()?.cells?.[userId]?.[serverId];
  }

  getCellReason(cell?: AccessMatrixCell): string {
    if (!cell) return 'Acesso negado';
    return formatAccessReason(cell, this.groupNameById());
  }

  getCellLabel(cell?: AccessMatrixCell): string {
    const reason = this.getCellReason(cell);
    const status = cell?.allowed ? 'Permitido' : 'Negado';
    return `${status}: ${reason}`;
  }

  protected errorText(): string {
    return apiErrorMessage(this.matrix.error(), 'Erro ao carregar a matriz de acesso.');
  }
}
