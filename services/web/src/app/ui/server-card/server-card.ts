import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { ServerSummary } from '../../core/api/models';
import { ButtonVariant, McButton } from '../button/button';
import { IconName } from '../icon/icon-registry';
import { McIcon } from '../icon/icon';
import { McStatusChip } from '../status-chip/status-chip';
import { McVoxelScene } from '../voxel-scene/voxel-scene';

export type ServerCardData = Pick<
  ServerSummary,
  | 'id'
  | 'name'
  | 'subdomain'
  | 'state'
  | 'server_type'
  | 'game_version'
  | 'allocated_memory_mb'
  | 'is_maintenance'
>;

export interface ServerPlayerCount {
  online: number;
  max: number;
}

export type PrimaryActionKind = 'start' | 'stop' | 'restart' | 'none';

export interface PrimaryAction {
  kind: PrimaryActionKind;
  label: string;
  variant: ButtonVariant;
  icon: IconName;
  disabled: boolean;
}

/** The one action offered on a card for each lifecycle state. */
export function serverPrimaryAction(state: ServerSummary['state']): PrimaryAction {
  switch (state) {
    case 'READY':
      return {
        kind: 'stop',
        label: 'Parar',
        variant: 'danger',
        icon: 'power-off',
        disabled: false,
      };
    case 'STOPPED':
      return { kind: 'start', label: 'Ligar', variant: 'primary', icon: 'play', disabled: false };
    case 'CRASHED':
      return {
        kind: 'restart',
        label: 'Reiniciar',
        variant: 'warning',
        icon: 'play',
        disabled: false,
      };
    case 'STARTING':
      return {
        kind: 'none',
        label: 'Iniciando…',
        variant: 'neutral',
        icon: 'time',
        disabled: true,
      };
    case 'STOPPING':
      return { kind: 'none', label: 'Parando…', variant: 'neutral', icon: 'time', disabled: true };
    case 'UPDATING':
      return {
        kind: 'none',
        label: 'Atualizando…',
        variant: 'neutral',
        icon: 'time',
        disabled: true,
      };
    case 'PROVISIONING':
      return { kind: 'none', label: 'Criando…', variant: 'neutral', icon: 'time', disabled: true };
    case 'FAILED':
      return {
        kind: 'none',
        label: 'Indisponível',
        variant: 'neutral',
        icon: 'square',
        disabled: true,
      };
  }
}

const TYPE_LABELS: Record<string, string> = {
  PAPER: 'Paper',
  VANILLA: 'Vanilla',
  FABRIC: 'Fabric',
  FORGE: 'Forge',
  NEOFORGE: 'NeoForge',
};

/** Stable small number from an id, used to vary the cover scene. */
export function sceneVariant(id: string): number {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % 3;
}

@Component({
  selector: 'mc-server-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McButton, McIcon, McStatusChip, McVoxelScene],
  host: { class: 'block h-full has-drop box-border' },
  template: `
    <article
      class="bevel-panel box-border flex h-full flex-col bg-surface-default"
      [attr.aria-label]="server().name"
    >
      <div class="relative">
        <mc-voxel-scene
          class="w-full"
          [variant]="variant()"
          [class.opacity-50]="server().state === 'STOPPED'"
        />
        <mc-status-chip class="absolute top-3 left-3" [state]="chipState()" />
      </div>
      <div class="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 class="t-title-sm">{{ server().name }}</h3>
          <p class="t-body-md text-text-muted">{{ server().subdomain }}</p>
        </div>
        <ul class="t-body-md flex flex-wrap items-center gap-x-4 gap-y-1 text-text-muted">
          <li class="inline-flex items-center gap-1">
            <mc-icon name="character" [size]="16" label="Jogadores" />
            @if (players(); as count) {
              {{ count.online }}/{{ count.max }}
            } @else {
              —
            }
          </li>
          <li>{{ typeLabel() }} {{ server().game_version }}</li>
          <li>{{ memoryLabel() }}</li>
        </ul>
        <div class="mt-auto flex gap-3 pt-1">
          <mc-button
            class="flex-1"
            [block]="true"
            size="sm"
            [variant]="action().variant"
            [icon]="action().icon"
            [disabled]="action().disabled || busy()"
            (click)="runPrimary()"
          >
            {{ action().label }}
          </mc-button>
          <mc-button size="sm" (click)="open.emit(server().id)">Abrir</mc-button>
        </div>
      </div>
    </article>
  `,
})
export class McServerCard {
  readonly server = input.required<ServerCardData>();
  /** Mocked until the backend exposes online players; the card then shows the no-API tag. */
  readonly players = input<ServerPlayerCount | null>(null);
  readonly busy = input(false);

  readonly start = output<string>();
  readonly stop = output<string>();
  readonly restart = output<string>();
  readonly open = output<string>();

  protected readonly action = computed(() => serverPrimaryAction(this.server().state));
  protected readonly chipState = computed(() =>
    this.server().is_maintenance ? 'MAINTENANCE' : this.server().state,
  );
  protected readonly variant = computed(() => sceneVariant(this.server().id));
  protected readonly typeLabel = computed(
    () => TYPE_LABELS[this.server().server_type] ?? this.server().server_type,
  );
  protected readonly memoryLabel = computed(() => `${this.server().allocated_memory_mb / 1024} GB`);

  protected runPrimary(): void {
    const id = this.server().id;
    switch (this.action().kind) {
      case 'start':
        this.start.emit(id);
        break;
      case 'stop':
        this.stop.emit(id);
        break;
      case 'restart':
        this.restart.emit(id);
        break;
    }
  }
}
