import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { SettingView, SettingsApi, SettingsSnapshot } from '../../core/api';
import { formatDateTime } from '../../core/format/format';
import { McBanner, McButton, McPanel, McSwitch, McTextField, ToastService } from '../../ui';
import { apiErrorMessage } from '../join/api-error';
import {
  Draft,
  buildChanges,
  currentText,
  flagOf,
  sourceDetail,
  textOf,
  validateDraft,
} from './settings.logic';

@Component({
  selector: 'mc-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, McBanner, McButton, McPanel, McSwitch, McTextField],
  template: `
    <div class="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 class="t-display-lg">Configurações</h1>
        <p class="t-body-lg mt-2 text-text-muted">
          Ajuste a rede, os convites e as integrações sem reiniciar o painel. O valor salvo aqui
          vale mais que o do ambiente do Kubernetes.
        </p>
      </header>

      @if (loadError()) {
        <mc-banner tone="danger" title="Não foi possível carregar as configurações">
          {{ loadError() }}
          <div class="mt-2">
            <mc-button size="sm" (click)="load()">Tentar de novo</mc-button>
          </div>
        </mc-banner>
      } @else if (snapshot(); as current) {
        @for (section of current.sections; track section.id) {
          <mc-panel [title]="section.title">
            <p class="t-body-md mb-5 text-text-muted">{{ section.description }}</p>
            <div class="flex flex-col gap-6">
              @for (setting of section.settings; track setting.key) {
                <div class="flex flex-col gap-2" [attr.data-setting]="setting.key">
                  @switch (setting.type) {
                    @case ('boolean') {
                      <mc-switch
                        [label]="setting.label"
                        [checked]="flag(setting)"
                        [disabled]="isReset(setting)"
                        (checkedChange)="setFlag(setting, $event)"
                      >
                        {{ setting.description }}
                      </mc-switch>
                    }
                    @case ('secret') {
                      <mc-text-field
                        type="password"
                        autocomplete="new-password"
                        [label]="setting.label"
                        [placeholder]="
                          isSet(setting) ? 'Digite para substituir' : (setting.placeholder ?? '')
                        "
                        [helpText]="setting.description"
                        [errorText]="errors()[setting.key] ?? ''"
                        [disabled]="isReset(setting)"
                        [ngModel]="text(setting)"
                        (ngModelChange)="setText(setting, $event)"
                      />
                    }
                    @default {
                      <mc-text-field
                        autocomplete="off"
                        [label]="setting.label"
                        [placeholder]="setting.placeholder ?? ''"
                        [helpText]="setting.description"
                        [errorText]="errors()[setting.key] ?? ''"
                        [inputmode]="setting.type === 'integer' ? 'numeric' : ''"
                        [disabled]="isReset(setting)"
                        [ngModel]="text(setting)"
                        (ngModelChange)="setText(setting, $event)"
                      />
                    }
                  }
                  <div class="t-caption flex flex-wrap items-center gap-x-3 gap-y-1 text-text-muted">
                    @if (setting.type === 'secret') {
                      <span
                        class="t-button-sm border-2 bg-bg-sunken px-2 py-0.5"
                        [class]="
                          isSet(setting)
                            ? 'border-status-success text-status-success'
                            : 'border-status-neutral text-status-neutral'
                        "
                        >{{ isSet(setting) ? 'DEFINIDA' : 'NÃO DEFINIDA' }}</span
                      >
                    }
                    <span>{{ detail(setting) }}</span>
                    @if (isReset(setting)) {
                      <span class="text-status-warning">
                        O valor salvo será removido ao salvar.
                      </span>
                      <button type="button" class="link-action" (click)="undoReset(setting)">
                        Desfazer
                      </button>
                    } @else if (setting.source === 'database') {
                      <button type="button" class="link-action" (click)="reset(setting)">
                        Voltar ao ambiente ou ao padrão
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          </mc-panel>
        }

        <mc-panel title="Diagnóstico (somente leitura)">
          <p class="t-body-md mb-4 text-text-muted">
            Estes valores vêm do manifesto do Kubernetes e só mudam com um novo deploy e o
            reinício do pod. As portas e os IPs confiáveis do gateway ficam no manifesto dele e não
            aparecem aqui.
          </p>
          <dl class="flex flex-col">
            @for (item of current.readOnly; track item.key) {
              <div
                class="grid gap-x-4 gap-y-1 border-b-2 border-border-strong py-3 sm:grid-cols-[1fr_auto]"
              >
                <dt class="t-body-strong">{{ item.label }}</dt>
                <dd class="m-0 flex flex-wrap items-center gap-2 sm:justify-end">
                  <code class="t-body-md break-all">{{ item.value || '(vazio)' }}</code>
                  <span
                    class="t-button-sm border-2 border-status-warning bg-bg-sunken px-2 py-0.5 text-status-warning"
                    >REQUER REINÍCIO</span
                  >
                </dd>
                <p class="t-caption text-text-muted sm:col-span-2">{{ item.envName }}</p>
              </div>
            }
          </dl>
        </mc-panel>

        @if (saveError()) {
          <mc-banner tone="danger" title="Não foi possível salvar">
            {{ saveError() }}
          </mc-banner>
        }

        <div
          class="bevel-panel sticky bottom-20 z-20 flex flex-wrap items-center justify-between gap-3 bg-surface-default p-3 md:bottom-4"
          role="region"
          aria-label="Salvar configurações"
        >
          <p class="t-body-md" role="status">{{ pendingText() }}</p>
          <div class="flex gap-3">
            <mc-button [disabled]="!dirty() || saving()" (click)="discard()">Descartar</mc-button>
            <mc-button variant="primary" [disabled]="!canSave()" (click)="save()">
              {{ saving() ? 'Salvando…' : 'Salvar alterações' }}
            </mc-button>
          </div>
        </div>
      } @else {
        <div class="flex flex-col gap-3" role="status" aria-label="Carregando configurações">
          <div class="h-40 animate-pulse bg-surface-hover"></div>
          <div class="h-40 animate-pulse bg-surface-hover"></div>
        </div>
      }
    </div>
  `,
  styles: `
    .link-action {
      min-height: 2.5rem;
      color: var(--color-status-info);
      text-decoration: underline;
      cursor: pointer;
    }
  `,
})
export class SettingsPage {
  private readonly api = inject(SettingsApi);
  private readonly toast = inject(ToastService);

  protected readonly snapshot = signal<SettingsSnapshot | null>(null);
  protected readonly loadError = signal('');
  protected readonly saveError = signal('');
  protected readonly saving = signal(false);
  private readonly draft = signal<Draft>({});
  private readonly resets = signal<ReadonlySet<string>>(new Set());

  private readonly settings = computed(
    () => this.snapshot()?.sections.flatMap((section) => section.settings) ?? [],
  );
  protected readonly errors = computed(() => validateDraft(this.settings(), this.draft()));
  private readonly changes = computed(() =>
    buildChanges(this.settings(), this.draft(), this.resets()),
  );
  private readonly changeCount = computed(() => Object.keys(this.changes()).length);
  protected readonly dirty = computed(() => this.changeCount() > 0);
  protected readonly canSave = computed(
    () => this.dirty() && Object.keys(this.errors()).length === 0 && !this.saving(),
  );
  protected readonly pendingText = computed(() => {
    const count = this.changeCount();
    if (count === 0) {
      return 'Nenhuma alteração pendente.';
    }
    return count === 1 ? '1 alteração pendente.' : `${count} alterações pendentes.`;
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loadError.set('');
    this.api.get().subscribe({
      next: (snapshot) => this.snapshot.set(snapshot),
      error: (error: unknown) => this.loadError.set(apiErrorMessage(error)),
    });
  }

  protected text(setting: SettingView): string {
    return textOf(setting, this.draft());
  }

  protected flag(setting: SettingView): boolean {
    return flagOf(setting, this.draft());
  }

  protected isSet(setting: SettingView): boolean {
    return setting.isSet === true;
  }

  protected isReset(setting: SettingView): boolean {
    return this.resets().has(setting.key);
  }

  protected detail(setting: SettingView): string {
    return sourceDetail(setting, formatDateTime);
  }

  protected setText(setting: SettingView, value: string): void {
    this.setDraft(setting, value, value === currentText(setting));
  }

  protected setFlag(setting: SettingView, value: boolean): void {
    this.setDraft(setting, value, value === (setting.value === true));
  }

  protected reset(setting: SettingView): void {
    this.setDraft(setting, undefined, true);
    this.resets.update((keys) => new Set(keys).add(setting.key));
  }

  protected undoReset(setting: SettingView): void {
    this.resets.update((keys) => {
      const next = new Set(keys);
      next.delete(setting.key);
      return next;
    });
  }

  protected discard(): void {
    this.draft.set({});
    this.resets.set(new Set());
    this.saveError.set('');
  }

  protected save(): void {
    if (!this.canSave()) {
      return;
    }
    this.saving.set(true);
    this.saveError.set('');
    this.api.update(this.changes()).subscribe({
      next: (snapshot) => {
        this.saving.set(false);
        this.snapshot.set(snapshot);
        this.discard();
        this.toast.success('Configurações salvas. Já valem, sem reiniciar.');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.saveError.set(apiErrorMessage(error, 'Confira os valores e tente de novo.'));
      },
    });
  }

  /** Keeps `draft` limited to what differs from the saved value, so "dirty" reflects real changes. */
  private setDraft(setting: SettingView, value: string | boolean | undefined, unchanged: boolean) {
    this.draft.update((draft) => {
      const next = { ...draft };
      if (value === undefined || (unchanged && setting.type !== 'secret')) {
        delete next[setting.key];
      } else {
        next[setting.key] = value;
      }
      return next;
    });
  }
}
