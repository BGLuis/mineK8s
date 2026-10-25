import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AdminApi, Group, UserSummary } from '../../core/api';
import { DialogService, McBanner, McButton, McDialog, McTextField, ToastService } from '../../ui';
import { apiErrorMessage } from '../join/api-error';
import { AccessStore } from './access.store';
import { ToggleChange, ToggleGroup, ToggleOption } from './toggle-group';

const NAME_MIN = 2;
const NAME_MAX = 50;

/** Plural-aware "N pessoa(s) · servidores". */
export function groupSummary(group: Group, serverNames: ReadonlyMap<string, string>): string {
  const people = group.user_groups.length;
  const names = group.server_groups
    .map((link) => serverNames.get(link.server_id))
    .filter((name): name is string => !!name);
  const peopleText = `${people} ${people === 1 ? 'pessoa' : 'pessoas'}`;
  return names.length > 0
    ? `${peopleText} · ${names.join(', ')}`
    : `${peopleText} · sem servidores`;
}

@Component({
  selector: 'mc-groups-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, McBanner, McButton, McDialog, McTextField, ToggleGroup],
  template: `
    <section aria-labelledby="groups-title">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h2 id="groups-title" class="t-title-md">Grupos</h2>
        <mc-button size="sm" variant="primary" (click)="openCreate()">Novo grupo</mc-button>
      </div>

      @if (groups.error()) {
        <mc-banner tone="danger" title="Não foi possível carregar os grupos">
          {{ errorText() }}
          <div class="mt-2">
            <mc-button size="sm" (click)="groups.reload()">Tentar de novo</mc-button>
          </div>
        </mc-banner>
      } @else if (groups.value(); as list) {
        @if (list.length === 0) {
          <p class="t-body-md text-text-muted">
            Nenhum grupo ainda. Grupos liberam vários servidores para várias pessoas de uma vez.
          </p>
        } @else {
          <ul class="grid gap-4 md:grid-cols-2">
            @for (group of list; track group.id) {
              <li class="has-drop">
                <div
                  class="bevel-panel flex items-center justify-between gap-3 bg-surface-default p-4"
                >
                  <div class="min-w-0">
                    <p class="t-label-md truncate">{{ group.name }}</p>
                    <p class="t-caption text-text-muted">{{ summary(group) }}</p>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <mc-button size="sm" (click)="openEdit(group)">Editar</mc-button>
                    <mc-button
                      size="sm"
                      variant="danger"
                      icon="trash"
                      [ariaLabel]="'Excluir grupo ' + group.name"
                      (click)="remove(group)"
                    />
                  </div>
                </div>
              </li>
            }
          </ul>
        }
      } @else {
        <div class="grid gap-4 md:grid-cols-2" role="status" aria-label="Carregando grupos">
          @for (row of skeleton; track row) {
            <div class="h-20 animate-pulse bg-surface-default"></div>
          }
        </div>
      }
    </section>

    <mc-dialog
      [(open)]="createOpen"
      title="Novo grupo"
      confirmLabel="Criar grupo"
      confirmVariant="primary"
      [confirmDisabled]="!!nameError()"
      (confirmed)="create()"
    >
      <div class="flex flex-col gap-3">
        <mc-text-field
          label="Nome do grupo"
          autocomplete="off"
          [maxlength]="nameMax"
          [helpText]="nameMin + ' a ' + nameMax + ' caracteres'"
          [ngModel]="newName()"
          (ngModelChange)="newName.set($event)"
          [ngModelOptions]="{ standalone: true }"
        />
        <mc-text-field
          label="Descrição (opcional)"
          autocomplete="off"
          [ngModel]="newDescription()"
          (ngModelChange)="newDescription.set($event)"
          [ngModelOptions]="{ standalone: true }"
        />
      </div>
    </mc-dialog>

    <mc-dialog
      [(open)]="editOpen"
      [title]="'Editar grupo' + (editing() ? ' · ' + editing()!.name : '')"
      confirmLabel="Concluído"
      confirmVariant="primary"
      cancelLabel="Fechar"
    >
      @if (editing(); as group) {
        <div class="flex flex-col gap-4" [attr.aria-busy]="pending() !== null">
          <mc-banner tone="warning" title="Remover alguém desconecta">
            Tirar uma pessoa do grupo expulsa ela dos servidores ligados que ela deixa de acessar.
          </mc-banner>
          <mc-toggle-group
            label="Pessoas"
            emptyText="Nenhum usuário encontrado."
            [options]="userOptions()"
            [selected]="memberIds(group)"
            (toggled)="toggleUser(group, $event)"
          />
          @if (memberIds(group).length > 0) {
            <div class="flex flex-wrap items-center gap-2">
              <span class="t-caption text-text-muted">Ver detalhes:</span>
              @for (userId of memberIds(group); track userId) {
                @if (getUser(userId); as u) {
                  <a
                    [routerLink]="['/access/users', u.id]"
                    class="t-caption text-action-primary hover:underline"
                  >
                    {{ u.minecraftNick }}
                  </a>
                }
              }
            </div>
          }
          <mc-toggle-group
            label="Servidores"
            emptyText="Nenhum servidor criado ainda."
            [options]="serverOptions()"
            [selected]="linkedServerIds(group)"
            (toggled)="toggleServer(group, $event)"
          />
        </div>
      }
    </mc-dialog>
  `,
})
export class GroupsPanel {
  private readonly store = inject(AccessStore);
  private readonly admin = inject(AdminApi);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);

  protected readonly groups = this.store.groups;
  protected readonly skeleton = [0, 1];
  protected readonly nameMin = NAME_MIN;
  protected readonly nameMax = NAME_MAX;

  protected readonly createOpen = signal(false);
  protected readonly newName = signal('');
  protected readonly newDescription = signal('');
  protected readonly nameError = computed(() => {
    const length = this.newName().trim().length;
    return length < NAME_MIN || length > NAME_MAX;
  });

  protected readonly editOpen = signal(false);
  private readonly editingId = signal<string | null>(null);
  protected readonly editing = computed(
    () => (this.groups.value() ?? []).find((group) => group.id === this.editingId()) ?? null,
  );
  /** Set while a membership change is in flight so toggles cannot race each other. */
  protected readonly pending = signal<string | null>(null);

  private readonly serverNames = computed(
    () => new Map((this.store.servers.value() ?? []).map((server) => [server.id, server.name])),
  );
  protected readonly serverOptions = computed<ToggleOption[]>(() =>
    (this.store.servers.value() ?? []).map((server) => ({ id: server.id, label: server.name })),
  );
  protected readonly userOptions = computed<ToggleOption[]>(() =>
    (this.store.users.value() ?? []).map((user) => ({ id: user.id, label: user.minecraftNick })),
  );

  protected errorText(): string {
    return apiErrorMessage(this.groups.error(), 'Tente de novo em instantes.');
  }

  protected summary(group: Group): string {
    return groupSummary(group, this.serverNames());
  }

  protected memberIds(group: Group): string[] {
    return group.user_groups.map((link) => link.user_id);
  }

  protected linkedServerIds(group: Group): string[] {
    return group.server_groups.map((link) => link.server_id);
  }

  protected getUser(userId: string): UserSummary | undefined {
    return (this.store.users.value() ?? []).find((u) => u.id === userId);
  }

  protected openCreate(): void {
    this.newName.set('');
    this.newDescription.set('');
    this.createOpen.set(true);
  }

  protected create(): void {
    const description = this.newDescription().trim();
    this.admin
      .createGroup({ name: this.newName().trim(), ...(description ? { description } : {}) })
      .subscribe({
        next: (group) => {
          this.toast.success(`Grupo "${group.name}" criado.`);
          this.groups.reload();
        },
        error: (error: unknown) =>
          this.toast.error(apiErrorMessage(error, 'Não foi possível criar o grupo.')),
      });
  }

  protected openEdit(group: Group): void {
    this.editingId.set(group.id);
    this.editOpen.set(true);
  }

  protected async remove(group: Group): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Excluir grupo',
      message: `O grupo "${group.name}" será apagado e quem dependia dele perde o acesso aos servidores ligados a ele.`,
      confirmLabel: 'Excluir grupo',
    });
    if (!confirmed) {
      return;
    }
    this.admin.deleteGroup(group.id).subscribe({
      next: () => {
        this.toast.success(`Grupo "${group.name}" excluído.`);
        this.groups.reload();
      },
      error: (error: unknown) =>
        this.toast.error(apiErrorMessage(error, 'Não foi possível excluir o grupo.')),
    });
  }

  protected toggleUser(group: Group, change: ToggleChange): void {
    if (this.pending()) {
      return;
    }
    this.pending.set(change.id);
    if (change.selected) {
      this.admin
        .addUserToGroup(group.id, change.id)
        .subscribe(this.settle('Pessoa adicionada ao grupo.'));
      return;
    }
    this.admin.removeUserFromGroup(group.id, change.id).subscribe({
      next: ({ kickedServers }) => {
        this.pending.set(null);
        this.toast.success(
          kickedServers.length > 0
            ? `Pessoa removida e desconectada de ${kickedServers.length} servidor(es).`
            : 'Pessoa removida do grupo.',
        );
        this.groups.reload();
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  protected toggleServer(group: Group, change: ToggleChange): void {
    if (this.pending()) {
      return;
    }
    this.pending.set(change.id);
    const request = change.selected
      ? this.admin.addServerToGroup(group.id, change.id)
      : this.admin.removeServerFromGroup(group.id, change.id);
    request.subscribe(
      this.settle(
        change.selected ? 'Servidor liberado para o grupo.' : 'Servidor removido do grupo.',
      ),
    );
  }

  private settle(message: string) {
    return {
      next: () => {
        this.pending.set(null);
        this.toast.success(message);
        this.groups.reload();
      },
      error: (error: unknown) => this.fail(error),
    };
  }

  private fail(error: unknown): void {
    this.pending.set(null);
    this.toast.error(apiErrorMessage(error, 'Não foi possível alterar o grupo.'));
    this.groups.reload();
  }
}
