import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { MinecraftVersionItem } from '../../core/api/models';
import { ServersApi } from '../../core/api/servers.api';
import { McIcon } from '../icon/icon';
import { SelectOption } from '../select/select';

let nextVersionSelectorId = 0;

@Component({
  selector: 'mc-version-selector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McIcon],
  host: { class: 'block' },
  template: `
    @if (label()) {
      <label class="t-label-md mb-1 block" [for]="id">{{ label() }}</label>
    }
    <div class="space-y-2">
      <div class="relative">
        <select
          [id]="id"
          class="bevel-sunken t-body-lg h-12 w-full appearance-none bg-surface-input px-3 pr-12 text-text-primary disabled:text-text-disabled"
          [disabled]="disabled() || loading()"
          [attr.aria-invalid]="invalid() || !!errorText() ? 'true' : null"
          [value]="value()"
          (change)="onSelectChange($event)"
        >
          @if (placeholder()) {
            <option value="" disabled [selected]="!value()">{{ placeholder() }}</option>
          }
          @for (opt of filteredOptions(); track opt.value) {
            <option [value]="opt.value" [disabled]="opt.disabled" [selected]="value() === opt.value">
              {{ opt.label }}
            </option>
          }
        </select>
        <mc-icon
          class="pointer-events-none absolute top-3 right-3 text-text-muted"
          name="chevron-down"
          [size]="24"
        />
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
        <input
          type="search"
          class="bevel-sunken t-body-sm h-9 flex-1 min-w-[140px] bg-surface-input px-2.5 text-text-primary placeholder:text-text-muted"
          placeholder="Filtrar versões…"
          aria-label="Filtrar versões"
          [value]="searchQuery()"
          (input)="searchQuery.set($any($event.target).value)"
        />
        <label class="flex cursor-pointer items-center gap-2 t-caption text-text-muted select-none">
          <input
            type="checkbox"
            class="size-4 shrink-0 accent-action-primary cursor-pointer"
            [checked]="showSnapshots()"
            (change)="onSnapshotsChange($any($event.target).checked)"
          />
          <span>Mostrar snapshots</span>
        </label>
      </div>

      @if (loading()) {
        <p class="t-caption text-text-muted animate-pulse">Carregando versões…</p>
      } @else if (errorText()) {
        <p class="t-caption text-status-danger" role="alert">{{ errorText() }}</p>
      } @else if (fetchError()) {
        <p class="t-caption text-status-danger" role="alert">{{ fetchError() }}</p>
      } @else if (hint()) {
        <p class="t-caption text-text-muted">{{ hint() }}</p>
      }
    </div>
  `,
})
export class McVersionSelector {
  protected readonly id = `mc-version-selector-${nextVersionSelectorId++}`;
  private readonly serversApi = inject(ServersApi, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  readonly label = input<string>('Versão do Minecraft');
  readonly placeholder = input<string>('Selecione uma versão');
  readonly hint = input<string>('');
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly errorText = input<string>('');
  readonly serverType = input<string>('');
  readonly versions = input<MinecraftVersionItem[] | null>(null);

  readonly value = model<string>('');

  readonly showSnapshots = signal(false);
  readonly searchQuery = signal('');
  readonly loadedVersions = signal<MinecraftVersionItem[]>([]);
  readonly loading = signal(false);
  readonly fetchError = signal<string | null>(null);

  readonly effectiveVersions = computed<MinecraftVersionItem[]>(() => {
    const raw = this.versions() ?? this.loadedVersions();
    if (this.showSnapshots()) {
      return raw;
    }
    return raw.filter((v) => v.kind === 'release');
  });

  readonly filteredOptions = computed<SelectOption[]>(() => {
    const list = this.effectiveVersions();
    const q = this.searchQuery().trim().toLowerCase();
    const filtered = q ? list.filter((v) => v.id.toLowerCase().includes(q)) : list;
    return filtered.map((v) => ({
      value: v.id,
      label: v.kind === 'snapshot' ? `${v.id} (snapshot)` : v.id,
    }));
  });

  constructor() {
    effect(() => {
      const type = this.serverType();
      const snapshots = this.showSnapshots();
      if (this.versions() !== null || !type || !this.serversApi) {
        return;
      }
      untracked(() => {
        this.fetchVersions(type, snapshots);
      });
    });
  }

  protected onSelectChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.value.set(val);
  }

  protected onSnapshotsChange(checked: boolean): void {
    this.showSnapshots.set(checked);
  }

  private fetchVersions(type: string, snapshots: boolean): void {
    if (!this.serversApi) return;
    this.loading.set(true);
    this.fetchError.set(null);

    this.serversApi
      .listMinecraftVersions(type, snapshots)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => {
          this.fetchError.set('Não foi possível carregar versões.');
          return of([]);
        }),
      )
      .subscribe((items) => {
        this.loadedVersions.set(items);
        this.loading.set(false);
      });
  }
}
