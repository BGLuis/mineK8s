import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, exhaustMap, forkJoin, map, merge, of, switchMap } from 'rxjs';

import { MockApi } from '../../core/api/mock-api';
import { ServersSocket } from '../../core/realtime/servers-socket';
import { ServerSummary } from '../../core/api/models';
import { TailscaleApi } from '../../core/api/tailscale.api';
import { ServersApi } from '../../core/api/servers.api';
import {
  McBanner,
  McButton,
  McIcon,
  McNoApiTag,
  McServerCard,
  McStatTile,
  ServerPlayerCount,
} from '../../ui';
import {
  TAILSCALE_DEVICE_LIMIT,
  compactSummaryText,
  summarizeServers,
  summaryText,
  tailscaleQuota,
} from './dashboard.logic';
import { ServerLifecycle } from './server-lifecycle';
import { liveRefresh } from './live-refresh';

const POLL_MS = 10_000;
const SKELETON_CARDS = [0, 1, 2];

interface Snapshot {
  servers: ServerSummary[];
  players: Record<string, ServerPlayerCount>;
}

@Component({
  selector: 'mc-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McBanner, McButton, McIcon, McNoApiTag, McServerCard, McStatTile, RouterLink],
  styles: `
    @media (prefers-reduced-motion: no-preference) {
      .skeleton {
        animation: mc-blink 1.4s steps(1, end) infinite;
      }
    }
  `,
  template: `
    <header class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="t-display-lg">Seus mundos</h1>
        @if (summary(); as s) {
          <p class="t-body-lg mt-2 text-text-muted" aria-live="polite">
            <span class="hidden md:inline">{{ fullSummary(s) }}</span>
            <span class="md:hidden">{{ compactSummary(s) }}</span>
          </p>
        }
      </div>
      <div class="hidden md:block">
        <mc-button variant="primary" icon="plus" (click)="create()">Criar servidor</mc-button>
      </div>
    </header>

    @if (diskAlert(); as alert) {
      <mc-banner class="mb-6" [tone]="alert.level" [title]="'Disco em ' + alert.percent + ' %'">
        {{ alert.level === 'danger' ? 'Acima de 90 % do volume.' : 'Acima de 75 % do volume.' }}
        Apague backups antigos ou aumente o disco.
        <mc-no-api-tag class="ml-1 align-middle" detail="alertas de disco" />
      </mc-banner>
    }

    <section class="mb-8 hidden gap-4 md:grid md:grid-cols-2 xl:grid-cols-4" aria-label="Recursos">
      @if (metrics(); as m) {
        <mc-stat-tile label="CPU" [value]="m.cpuPercent" [detail]="m.cpuLabel" [noApi]="true" />
        <mc-stat-tile label="RAM" [value]="m.ramPercent" [detail]="m.ramLabel" [noApi]="true" />
        <mc-stat-tile label="NVMe" [value]="m.nvmePercent" [detail]="m.nvmeLabel" [noApi]="true" />
      } @else {
        @for (n of skeletonTiles; track n) {
          <div class="skeleton has-drop h-full">
            <div class="bevel-panel h-32 bg-surface-default"></div>
          </div>
        }
      }
      @if (quota(); as q) {
        <mc-stat-tile
          label="Tailscale"
          [value]="q.percent"
          [detail]="q.used + '/' + q.limit + ' dispositivos ativos na cota'"
        />
      }
    </section>

    <section aria-labelledby="servers-heading">
      <div class="mb-4 hidden items-center justify-between gap-4 md:flex">
        <h2 id="servers-heading" class="t-title-sm">Servidores</h2>
      </div>

      @if (error() && servers() !== null) {
        <mc-banner class="mb-4" tone="warning" title="Lista desatualizada">
          Não foi possível atualizar os servidores. Tentando de novo em alguns segundos.
        </mc-banner>
      }

      @let list = servers();
      @if (list === null) {
        @if (error()) {
          <mc-banner tone="danger" title="Não foi possível carregar os servidores">
            <p class="mb-3">Verifique a conexão com o servidor de controle e tente novamente.</p>
            <mc-button variant="light" size="sm" (click)="refresh()">Tentar de novo</mc-button>
          </mc-banner>
        } @else {
          <div
            class="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3"
            role="status"
            aria-label="Carregando servidores"
          >
            @for (n of skeletonCards; track n) {
              <div class="skeleton has-drop h-full">
                <div class="bevel-panel h-80 bg-surface-default"></div>
              </div>
            }
          </div>
        }
      } @else if (list.length === 0) {
        <div
          class="bevel-panel has-drop flex flex-col items-center gap-4 bg-surface-default p-8 text-center"
        >
          <mc-icon name="pickaxe" [size]="32" />
          <h3 class="t-title-sm">Nenhum mundo ainda</h3>
          <p class="t-body-md max-w-md text-text-muted">
            Crie o primeiro servidor: Vanilla, Paper ou um modpack em menos de um minuto.
          </p>
          <mc-button variant="primary" icon="plus" (click)="create()">Criar servidor</mc-button>
        </div>
      } @else {
        <ul class="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          @for (server of list; track server.id) {
            <li>
              <mc-server-card
                [server]="server"
                [players]="players()[server.id] ?? null"
                [busy]="lifecycle.busy().has(server.id)"
                (start)="run('start', server)"
                (stop)="run('stop', server)"
                (restart)="run('restart', server)"
                (open)="open($event)"
              />
            </li>
          }
          <li class="hidden md:block">
            <a
              routerLink="/servers/new"
              class="flex h-full min-h-72 flex-col items-center justify-center gap-3 border-4 border-dashed border-border-default p-6 text-center hover:border-text-muted"
            >
              <mc-icon name="pickaxe" [size]="32" />
              <span class="t-title-sm">Novo mundo</span>
              <span class="t-body-md max-w-xs text-text-muted">
                Vanilla, Paper ou modpack em menos de 1 minuto
              </span>
            </a>
          </li>
        </ul>
      }
    </section>
  `,
})
export class DashboardPage {
  private readonly serversApi = inject(ServersApi);
  private readonly tailscale = inject(TailscaleApi);
  private readonly mock = inject(MockApi);
  private readonly serversSocket = inject(ServersSocket);
  private readonly router = inject(Router);
  protected readonly lifecycle = inject(ServerLifecycle);

  protected readonly skeletonCards = SKELETON_CARDS;
  protected readonly skeletonTiles = [0, 1, 2];
  protected readonly fullSummary = summaryText;
  protected readonly compactSummary = compactSummaryText;

  protected readonly servers = signal<ServerSummary[] | null>(null);
  protected readonly players = signal<Record<string, ServerPlayerCount>>({});
  protected readonly error = signal(false);

  protected readonly summary = computed(() => {
    const servers = this.servers();
    return servers ? summarizeServers(servers, this.players()) : null;
  });

  protected readonly metrics = toSignal(this.mock.nodeMetrics().pipe(catchError(() => of(null))), {
    initialValue: null,
  });
  private readonly alerts = toSignal(this.mock.diskAlerts().pipe(catchError(() => of([]))), {
    initialValue: [],
  });
  protected readonly diskAlert = computed(
    () => this.alerts().find((alert) => alert.level === 'danger') ?? this.alerts()[0] ?? null,
  );
  /** Null while loading or when the caller may not list devices (admin-only endpoint). */
  protected readonly quota = toSignal(
    this.tailscale.listDevices().pipe(
      map((devices) => tailscaleQuota(devices, TAILSCALE_DEVICE_LIMIT)),
      catchError(() => of(null)),
    ),
    { initialValue: null },
  );

  private readonly refresh$ = new Subject<void>();

  constructor() {
    merge(liveRefresh(this.serversSocket.signals(), POLL_MS), this.refresh$)
      .pipe(
        exhaustMap(() => this.load()),
        takeUntilDestroyed(),
      )
      .subscribe((snapshot) => {
        this.servers.set(snapshot.servers);
        this.players.set(snapshot.players);
        this.error.set(false);
      });
  }

  protected refresh(): void {
    this.error.set(false);
    this.refresh$.next();
  }

  protected create(): void {
    void this.router.navigate(['/servers/new']);
  }

  protected open(id: string): void {
    void this.router.navigate(['/servers', id]);
  }

  protected async run(action: 'start' | 'stop' | 'restart', server: ServerSummary): Promise<void> {
    if (await this.lifecycle.run(action, server)) {
      this.refresh$.next();
    }
  }

  private load() {
    return this.serversApi.list().pipe(
      switchMap((servers) => {
        const online = servers.filter((server) => server.state === 'READY');
        const counts = online.length
          ? forkJoin(
              online.map((server) =>
                this.serversApi
                  .players(server.id)
                  .pipe(
                    map((p): [string, ServerPlayerCount] => [
                      server.id,
                      { online: p.online, max: p.max },
                    ]),
                  ),
              ),
            )
          : of([] as [string, ServerPlayerCount][]);
        return counts.pipe(
          map((entries): Snapshot => ({ servers, players: Object.fromEntries(entries) })),
        );
      }),
      catchError(() => {
        this.error.set(true);
        return EMPTY;
      }),
    );
  }
}
