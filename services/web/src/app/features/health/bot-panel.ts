import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, skip } from 'rxjs';

import { HealthApi, HealthBotReport, ServersApi } from '../../core/api';
import { McBanner, McButton, McIcon, McPanel, McTable, ToastService } from '../../ui';
import { visiblePoll } from '../../core/polling/visible-poll';
import { apiErrorMessage } from '../join/api-error';
import { BotRow, TONE_TEXT, botRow } from './health-views';

const REFRESH_MS = 30_000;

@Component({
  selector: 'mc-bot-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McPanel, McBanner, McButton, McIcon, McTable],
  template: `
    <mc-panel title="Bot de saúde · teste de login periódico">
      @if (overview.error()) {
        <mc-banner tone="danger" title="Não foi possível carregar o bot de saúde">
          {{ errorText() }}
          <div class="mt-2">
            <mc-button size="sm" (click)="reload()">Tentar de novo</mc-button>
          </div>
        </mc-banner>
      } @else if (overview.value()) {
        <div class="overflow-x-auto">
          <table mc-table class="min-w-160">
            <caption class="sr-only">
              Resultado do último teste de login por servidor
            </caption>
            <thead>
              <tr>
                <th scope="col">Servidor</th>
                <th scope="col">Etapa</th>
                <th scope="col" class="mc-cell-num">Latência</th>
                <th scope="col">Modo</th>
                <th scope="col"><span class="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.serverId) {
                <tr>
                  <td class="t-body-strong">{{ row.name }}</td>
                  <td>
                    <span [class]="toneText[row.stage.tone]">
                      @if (row.stage.tone === 'success') {
                        <mc-icon name="check" [size]="16" />
                      } @else if (row.stage.tone === 'danger') {
                        <mc-icon name="close" [size]="16" />
                      }
                      {{ row.stage.label }}
                      @if (row.stage.code) {
                        <span class="text-text-muted">({{ row.stage.code }})</span>
                      }
                    </span>
                    @if (row.stage.error) {
                      <p class="t-caption mt-1 max-w-80 text-text-muted">{{ row.stage.error }}</p>
                    }
                  </td>
                  <td class="mc-cell-num" [attr.title]="row.latencyTitle || null">
                    {{ row.latency }}
                  </td>
                  <td class="text-text-muted">{{ row.mode }}</td>
                  <td>
                    <div class="flex justify-end">
                      <mc-button
                        size="sm"
                        [disabled]="isProbing(row.serverId)"
                        [ariaLabel]="'Testar ' + row.name + ' agora'"
                        (click)="probe(row)"
                      >
                        {{ isProbing(row.serverId) ? 'Testando…' : 'Testar agora' }}
                      </mc-button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="text-text-muted">
                    Nenhum servidor para testar. Crie um servidor para o bot começar a verificar.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="flex flex-col gap-2" role="status" aria-label="Carregando bot de saúde">
          @for (row of skeleton; track row) {
            <div class="h-12 animate-pulse bg-surface-hover"></div>
          }
        </div>
      }
    </mc-panel>
  `,
})
export class BotPanel {
  private readonly health = inject(HealthApi);
  private readonly toast = inject(ToastService);
  private readonly serversApi = inject(ServersApi);

  protected readonly overview = rxResource({ stream: () => this.health.overview() });
  /** Names come from the server list; the overview only has the subdomain. A failure here is not fatal. */
  private readonly servers = rxResource({
    stream: () => this.serversApi.list().pipe(catchError(() => of([]))),
  });
  private readonly probed = signal<Readonly<Record<string, HealthBotReport>>>({});
  private readonly probing = signal<ReadonlySet<string>>(new Set());

  protected readonly toneText = TONE_TEXT;
  protected readonly skeleton = [0, 1, 2];

  protected readonly rows = computed<BotRow[]>(() => {
    const names = new Map((this.servers.value() ?? []).map((server) => [server.id, server.name]));
    const probed = this.probed();
    return Object.values(this.overview.value()?.servers ?? {}).map((server) =>
      botRow(
        server,
        names.get(server.serverId) ?? server.subdomain,
        probed[server.serverId] ?? server.latestReport,
      ),
    );
  });

  constructor() {
    // The bot runs on its own schedule, so new reports arrive without any click.
    visiblePoll(REFRESH_MS)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.overview.reload());
  }

  protected errorText(): string {
    return apiErrorMessage(this.overview.error(), 'Tente de novo em instantes.');
  }

  protected reload(): void {
    this.overview.reload();
  }

  protected isProbing(serverId: string): boolean {
    return this.probing().has(serverId);
  }

  protected probe(row: BotRow): void {
    this.probing.update((set) => new Set(set).add(row.serverId));
    this.health.probe(row.serverId).subscribe({
      next: (report) => {
        this.stopProbing(row.serverId);
        this.probed.update((current) => ({ ...current, [row.serverId]: report }));
        this.toast.show(
          report.healthy ? 'success' : 'danger',
          report.healthy
            ? `${row.name}: o bot entrou com sucesso.`
            : `${row.name}: o teste falhou.${report.error ? ' ' + report.error : ''}`,
        );
      },
      error: (error: unknown) => {
        this.stopProbing(row.serverId);
        this.toast.error(apiErrorMessage(error, `Não foi possível testar ${row.name}.`));
      },
    });
  }

  private stopProbing(serverId: string): void {
    this.probing.update((set) => {
      const next = new Set(set);
      next.delete(serverId);
      return next;
    });
  }
}
