import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import {
  McBanner,
  McButton,
  McIcon,
  McStatusChip,
  McTabItem,
  McTabs,
  McVoxelScene,
  sceneVariant,
  statusChipConfig,
} from '../../ui';
import { formatDuration, serverTypeLabel } from './format';
import { headerActions } from './header-actions';
import { McPublishDialog } from './publish-dialog';
import { ServerDetailStore } from './server-detail.store';

/** Layout for `/servers/:id`; the router binds `:id` to the `id` input. */
@Component({
  selector: 'mc-server-details-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ServerDetailStore],
  imports: [
    McBanner,
    McButton,
    McIcon,
    McPublishDialog,
    McStatusChip,
    McTabs,
    McVoxelScene,
    RouterLink,
    RouterOutlet,
  ],
  styles: `
    @media (prefers-reduced-motion: no-preference) {
      .skeleton {
        animation: mc-blink 1.4s steps(1, end) infinite;
      }
    }
  `,
  template: `
    @let server = store.server();
    <nav class="t-body-md mb-4 flex items-center gap-2 text-text-muted" aria-label="Você está em">
      <a routerLink="/" class="hover:text-text-primary">Seus mundos</a>
      <mc-icon name="chevron" [size]="16" />
      <span class="text-text-primary" aria-current="page">{{ server?.name ?? 'Servidor' }}</span>
    </nav>

    @if (server; as s) {
      <header class="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div class="flex min-w-0 flex-1 basis-96 items-start gap-4">
          <div class="size-16 shrink-0 overflow-hidden border-2 border-border-strong">
            <mc-voxel-scene
              class="block h-full w-full"
              style="aspect-ratio: auto"
              [variant]="variant()"
            />
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h1 class="t-display-lg break-words">{{ s.name }}</h1>
              <mc-status-chip [state]="s.is_maintenance ? 'MAINTENANCE' : s.state" />
            </div>
            <p class="t-body-md mt-2 flex flex-wrap items-center gap-x-2 text-text-muted">
              <span>{{ s.subdomain }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ typeLabel() }} {{ s.game_version }}</span>
              @if (s.server_build) {
                <span aria-hidden="true">·</span>
                <span>build {{ s.server_build }} {{ s.server_build_channel }}</span>
              }
              @if (s.java_version) {
                <span aria-hidden="true">·</span>
                <span>Java {{ s.java_version }}</span>
              }
              @if (uptime(); as up) {
                <span aria-hidden="true">·</span>
                <span>online há {{ up }}</span>
              }
              @if (store.accessPolicy() === 'INTERNET') {
                <span aria-hidden="true">·</span>
                <span class="text-status-warning">publicado na internet</span>
              }
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <mc-button
            size="sm"
            [variant]="published() ? 'neutral' : 'warning'"
            [disabled]="publish.busy()"
            (click)="publish.open()"
          >
            {{ published() ? 'Despublicar' : 'Publicar' }}
          </mc-button>
          <mc-button
            size="sm"
            [disabled]="!actions().restartEnabled || store.busy()"
            (click)="store.run('restart')"
          >
            Reiniciar
          </mc-button>
          <mc-button
            size="sm"
            [variant]="actions().power.variant"
            [icon]="actions().power.icon"
            [disabled]="actions().power.disabled || store.busy()"
            (click)="power()"
          >
            {{ actions().power.label }}
          </mc-button>
        </div>
      </header>
      <mc-publish-dialog #publish [serverName]="s.name" />
      <p class="sr-only" role="status">Estado do servidor: {{ announcement() }}</p>
      @if (store.stale()) {
        <mc-banner class="mb-4" tone="warning" title="Dados desatualizados">
          Não foi possível atualizar o estado do servidor. Tentando de novo em alguns segundos.
        </mc-banner>
      }
    } @else if (store.loadState() === 'not-found') {
      <mc-banner tone="danger" title="Servidor não encontrado">
        <p class="mb-3">Este mundo não existe mais ou o endereço está incorreto.</p>
        <a routerLink="/" class="t-button-sm underline">Voltar para Seus mundos</a>
      </mc-banner>
    } @else if (store.loadState() === 'error') {
      <mc-banner tone="danger" title="Não foi possível carregar o servidor">
        <p class="mb-3">Verifique a conexão com o servidor de controle e tente novamente.</p>
        <mc-button variant="light" size="sm" (click)="store.refresh()">Tentar de novo</mc-button>
      </mc-banner>
    } @else {
      <div class="mb-6 flex gap-4" role="status" aria-label="Carregando servidor">
        <div class="skeleton size-16 bg-surface-default"></div>
        <div class="skeleton h-16 w-80 max-w-full bg-surface-default"></div>
      </div>
    }

    @if (store.loadState() !== 'not-found') {
      <mc-tabs class="mb-6" [tabs]="tabs()" label="Seções do servidor" />
      <router-outlet />
    }
  `,
})
export class ServerDetailsPage {
  protected readonly store = inject(ServerDetailStore);

  readonly id = input.required<string>();

  protected readonly tabs = computed<McTabItem[]>(() => {
    const base = ['/servers', this.id()];
    return [
      { id: 'overview', label: 'Visão geral', link: base },
      { id: 'console', label: 'Console', link: [...base, 'console'] },
      { id: 'world', label: 'Mundo', link: [...base, 'world'] },
      { id: 'files', label: 'Arquivos', link: [...base, 'files'] },
      { id: 'backups', label: 'Backups', link: [...base, 'backups'] },
      { id: 'access', label: 'Rede e acesso', link: ['/access'] },
    ];
  });

  protected readonly actions = computed(() => {
    const server = this.store.server();
    return headerActions(server?.state ?? 'FAILED');
  });
  protected readonly published = computed(() => this.store.accessPolicy() === 'INTERNET');
  protected readonly variant = computed(() => sceneVariant(this.id()));
  protected readonly typeLabel = computed(() =>
    serverTypeLabel(this.store.server()?.server_type ?? ''),
  );
  protected readonly uptime = computed(() => {
    const seconds = this.store.stats()?.uptimeSeconds;
    return seconds == null ? null : formatDuration(seconds);
  });
  protected readonly announcement = computed(() => {
    const server = this.store.server();
    if (!server) {
      return '';
    }
    return statusChipConfig(server.is_maintenance ? 'MAINTENANCE' : server.state).label;
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.store.watch(id));
    });
  }

  protected power(): void {
    const kind = this.actions().power.kind;
    if (kind === 'start' || kind === 'stop') {
      void this.store.run(kind);
    }
  }
}
