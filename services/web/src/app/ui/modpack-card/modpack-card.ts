import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Modpack, ModpackSource, ModpackVersion } from '../../core/api/models';
import { McIcon } from '../icon/icon';
import { sceneVariant } from '../server-card/server-card';
import { McVoxelScene } from '../voxel-scene/voxel-scene';

const SOURCE_LABELS: Record<ModpackSource, string> = {
  MODRINTH: 'Modrinth',
  CURSEFORGE: 'CurseForge',
  VANILLA: 'Vanilla',
  CUSTOM: 'Personalizado',
};

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

export function formatDownloads(count: number): string {
  return `${compact.format(count)} downloads`;
}

@Component({
  selector: 'mc-modpack-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McIcon, McVoxelScene],
  host: { class: 'block has-drop' },
  template: `
    <button
      type="button"
      class="flex w-full gap-4 bg-surface-default text-left"
      [class]="selected() ? 'border-selected p-3' : 'bevel-panel p-4'"
      [attr.aria-pressed]="selected()"
      (click)="choose.emit(modpack().id)"
    >
      <div class="h-24 w-48 shrink-0 overflow-hidden max-sm:hidden">
        @if (modpack().iconUrl) {
          <img class="pixelated size-full object-cover" [src]="modpack().iconUrl" alt="" />
        } @else {
          <mc-voxel-scene class="size-full" [variant]="variant()" />
        }
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="t-title-sm">{{ modpack().name }}</h3>
        <p class="t-caption text-text-muted">
          por {{ modpack().author ?? 'autor desconhecido' }} · {{ sourceLabel() }}
        </p>
        <p class="t-body-md my-2 text-text-primary">{{ modpack().summary }}</p>
        <ul class="t-caption flex flex-wrap items-center gap-x-4 gap-y-1 text-text-muted">
          @if (version(); as v) {
            <li class="inline-flex items-center gap-1">
              <mc-icon name="time" [size]="16" />{{ publishedAt() }}
            </li>
            <li>{{ v.gameVersion }}</li>
            <li class="capitalize">{{ v.loader }}</li>
          }
          <li class="inline-flex items-center gap-1">
            <mc-icon name="stats" [size]="16" />{{ downloads() }}
          </li>
        </ul>
      </div>
    </button>
  `,
})
export class McModpackCard {
  readonly modpack = input.required<Modpack>();
  /** Latest version, when already fetched from the versions endpoint. */
  readonly version = input<ModpackVersion | null>(null);
  readonly selected = input(false);
  readonly choose = output<string>();

  protected readonly variant = computed(() => sceneVariant(this.modpack().id));
  protected readonly sourceLabel = computed(() => SOURCE_LABELS[this.modpack().source]);
  protected readonly downloads = computed(() => formatDownloads(this.modpack().downloads));
  protected readonly publishedAt = computed(() => {
    const date = this.version()?.datePublished;
    return date ? new Date(date).toLocaleDateString('pt-BR') : '';
  });
}
