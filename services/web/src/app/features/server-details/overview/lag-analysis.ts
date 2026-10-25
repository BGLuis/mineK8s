import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { LagPlayer, LagSnapshot } from '../../../core/api/models';
import { ServersApi } from '../../../core/api/servers.api';
import { McBanner, McButton, McPanel, McTable } from '../../../ui';
import { errorReason } from '../../../core/api/api-error';

const count = (value: number | null): string =>
  value === null ? '—' : value.toLocaleString('pt-BR');

@Component({
  selector: 'mc-lag-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McBanner, McButton, McPanel, McTable],
  template: `
    <mc-panel title="Análise de lag">
      <p class="t-body-md mb-4 text-text-muted">
        Tira um retrato agora: entidades e itens no chão em cada dimensão e perto de cada jogador.
        No Paper e no Purpur também mostra os tipos de entidade mais comuns; no Forge e no NeoForge, o
        tempo de tick de cada dimensão.
      </p>
      <mc-button size="sm" [disabled]="loading()" (click)="analyze()">
        {{ loading() ? 'Analisando…' : snapshot() ? 'Analisar de novo' : 'Analisar lag' }}
      </mc-button>

      @if (error(); as message) {
        <mc-banner class="mt-4" tone="danger" title="Não foi possível analisar o lag">
          {{ message }}
        </mc-banner>
      }

      @if (snapshot(); as snapshot) {
        <div class="mt-4 flex flex-col gap-3">
          @if (!hasWarnings()) {
            <p class="t-body-md" role="status">
              Nada fora do normal neste momento. Se o lag vem e vai, analise de novo durante o engasgo.
            </p>
          }
          @for (finding of snapshot.findings; track $index) {
            <mc-banner
              [tone]="finding.severity === 'warning' ? 'warning' : 'info'"
              [title]="finding.severity === 'warning' ? 'Possível causa' : 'Observação'"
            >
              {{ finding.message }}
            </mc-banner>
          }
        </div>

        <div class="mt-4 overflow-x-auto">
          <table mc-table class="min-w-160">
            <caption class="t-caption pb-2 text-left text-text-muted">
              Dimensões · retrato das {{ takenAt() }}
            </caption>
            <thead>
              <tr>
                <th scope="col">Dimensão</th>
                <th scope="col">Jogadores</th>
                <th scope="col" class="mc-cell-num">Entidades</th>
                <th scope="col" class="mc-cell-num">Itens no chão</th>
                @if (hasTickTimes()) {
                  <th scope="col" class="mc-cell-num">Tick médio</th>
                }
                @if (hasEntityTypes()) {
                  <th scope="col">Tipos mais comuns</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (dimension of snapshot.dimensions; track dimension.id) {
                <tr>
                  <td>{{ dimension.id }}</td>
                  <td>{{ dimension.players.join(', ') || '—' }}</td>
                  <td class="mc-cell-num">{{ count(dimension.entities) }}</td>
                  <td class="mc-cell-num">{{ count(dimension.items) }}</td>
                  @if (hasTickTimes()) {
                    <td class="mc-cell-num">
                      {{ dimension.meanTickMs === null ? '—' : milliseconds(dimension.meanTickMs) }}
                    </td>
                  }
                  @if (hasEntityTypes()) {
                    <td>
                      @for (entry of dimension.topEntities; track entry.type; let last = $last) {
                        {{ entry.type }} ({{ count(entry.count) }}){{ last ? '' : ', ' }}
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (snapshot.players.length > 0) {
          <div class="mt-4 overflow-x-auto">
            <table mc-table class="min-w-160">
              <caption class="t-caption pb-2 text-left text-text-muted">
                Jogadores · contagem num raio de {{ snapshot.radius }} blocos
              </caption>
              <thead>
                <tr>
                  <th scope="col">Jogador</th>
                  <th scope="col">Dimensão</th>
                  <th scope="col">Posição</th>
                  <th scope="col" class="mc-cell-num">Entidades perto</th>
                  <th scope="col" class="mc-cell-num">Itens perto</th>
                </tr>
              </thead>
              <tbody>
                @for (player of snapshot.players; track player.nick) {
                  <tr>
                    <td>{{ player.nick }}</td>
                    <td>{{ player.dimension ?? '—' }}</td>
                    <td>{{ position(player) }}</td>
                    <td class="mc-cell-num">{{ count(player.nearbyEntities) }}</td>
                    <td class="mc-cell-num">{{ count(player.nearbyItems) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </mc-panel>
  `,
})
export class McLagAnalysis {
  readonly serverId = input.required<string>();

  private readonly serversApi = inject(ServersApi);

  protected readonly snapshot = signal<LagSnapshot | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly hasWarnings = computed(
    () => this.snapshot()?.findings.some((finding) => finding.severity === 'warning') ?? false,
  );
  protected readonly hasTickTimes = computed(
    () => this.snapshot()?.dimensions.some((dimension) => dimension.meanTickMs !== null) ?? false,
  );
  protected readonly hasEntityTypes = computed(
    () =>
      this.snapshot()?.dimensions.some((dimension) => dimension.topEntities.length > 0) ?? false,
  );
  protected readonly takenAt = computed(() => {
    const snapshot = this.snapshot();
    return snapshot ? new Date(snapshot.takenAt).toLocaleTimeString('pt-BR') : '';
  });

  protected readonly count = count;

  protected milliseconds(value: number): string {
    return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ms`;
  }

  protected position(player: LagPlayer): string {
    const position = player.position;
    return position
      ? `${Math.round(position.x)}, ${Math.round(position.y)}, ${Math.round(position.z)}`
      : '—';
  }

  protected async analyze(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.snapshot.set(await firstValueFrom(this.serversApi.lagSnapshot(this.serverId())));
    } catch (error) {
      this.error.set(errorReason(error));
    } finally {
      this.loading.set(false);
    }
  }
}
