import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { HealthApi, ReconcilerStatus, ReconciliationSummary } from '../../core/api';
import { McBanner, McButton, McPanel, ToastService } from '../../ui';
import { formatRelative } from '../access/format';
import { apiErrorMessage } from '../join/api-error';
import { divergences, formatDuration, isIdle } from './health-views';

@Component({
  selector: 'mc-reconciler-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McPanel, McBanner, McButton],
  template: `
    <mc-panel title="Sincronização com o cluster">
      <mc-button panelActions size="sm" [disabled]="running()" (click)="trigger()">
        {{ running() ? 'Reconciliando…' : 'Reconciliar agora' }}
      </mc-button>

      @if (error()) {
        <mc-banner tone="danger" title="Não foi possível consultar a sincronização">
          {{ error() }}
          <div class="mt-2">
            <mc-button size="sm" (click)="load()">Tentar de novo</mc-button>
          </div>
        </mc-banner>
      } @else if (status() === null) {
        <div class="flex flex-col gap-2" role="status" aria-label="Carregando sincronização">
          <div class="h-5 animate-pulse bg-surface-hover"></div>
          <div class="h-5 animate-pulse bg-surface-hover"></div>
          <div class="h-5 animate-pulse bg-surface-hover"></div>
        </div>
      } @else if (summary(); as last) {
        <dl class="t-body-md m-0 flex flex-col gap-2" [attr.aria-busy]="running()">
          <div class="flex justify-between gap-4">
            <dt class="text-text-muted">Última execução</dt>
            <dd class="t-body-strong m-0">{{ lastRun() }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-text-muted">Servidores verificados</dt>
            <dd class="t-body-strong m-0">{{ last.checked }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-text-muted">Divergências corrigidas</dt>
            <dd
              class="t-body-strong m-0 text-right"
              [class]="fixes().length > 0 ? 'text-status-warning' : 'text-status-success'"
            >
              {{ fixes().length }}
            </dd>
          </div>
          @if (fixes().length > 0) {
            <div class="t-caption text-text-muted">{{ fixes().join(' · ') }}</div>
          }
          <div class="flex justify-between gap-4">
            <dt class="text-text-muted">Mudanças de estado</dt>
            <dd class="t-body-strong m-0">{{ last.stateTransitions.length }}</dd>
          </div>
        </dl>
      } @else {
        <p class="t-body-md text-text-muted">
          Nenhuma sincronização rodou ainda. Use "Reconciliar agora" para comparar o banco com o
          Kubernetes.
        </p>
      }
    </mc-panel>
  `,
})
export class ReconcilerPanel {
  private readonly health = inject(HealthApi);
  private readonly toast = inject(ToastService);

  protected readonly status = signal<ReconcilerStatus | null>(null);
  protected readonly error = signal('');
  protected readonly running = signal(false);

  protected readonly summary = computed<ReconciliationSummary | null>(() => {
    const status = this.status();
    return status && !isIdle(status) ? status : null;
  });
  protected readonly fixes = computed(() => {
    const summary = this.summary();
    return summary ? divergences(summary) : [];
  });
  protected readonly lastRun = computed(() => {
    const summary = this.summary();
    return summary
      ? `${formatRelative(summary.timestamp)} · ${formatDuration(summary.durationMs)}`
      : '';
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.error.set('');
    this.health.reconcilerStatus().subscribe({
      next: (status) => this.status.set(status),
      error: (error: unknown) =>
        this.error.set(apiErrorMessage(error, 'Tente de novo em instantes.')),
    });
  }

  protected trigger(): void {
    this.running.set(true);
    this.health.triggerReconciliation().subscribe({
      next: (summary) => {
        this.running.set(false);
        this.status.set(summary);
        this.toast.success('Sincronização concluída.');
      },
      error: (error: unknown) => {
        this.running.set(false);
        this.toast.error(apiErrorMessage(error, 'Não foi possível reconciliar agora.'));
      },
    });
  }
}
