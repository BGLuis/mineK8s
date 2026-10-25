import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ServersApi } from '../../core/api';
import { PlayerServer } from '../../core/api/models';
import { AuthSession } from '../../core/auth';
import { McBanner, McButton, McLegalFooter, McPanel } from '../../ui';

export function formatPlayerServerState(state: string): string {
  switch (state) {
    case 'READY':
      return 'Pronto';
    case 'STOPPED':
      return 'Hibernando';
    case 'CRASHED':
    case 'FAILED':
      return 'Desligado';
    case 'MAINTENANCE':
      return 'Em manutenção';
    case 'STARTING':
      return 'Iniciando';
    case 'STOPPING':
      return 'Parando';
    case 'PROVISIONING':
      return 'Provisionando';
    case 'UPDATING':
      return 'Atualizando';
    default:
      return state;
  }
}

export function playerServerStateBadgeClass(state: string): string {
  switch (state) {
    case 'READY':
      return 'border-status-success text-status-success bg-status-success/10';
    case 'MAINTENANCE':
      return 'border-status-warning text-status-warning bg-status-warning/10';
    case 'STOPPED':
      return 'border-border-default text-text-muted bg-bg-surface';
    case 'CRASHED':
    case 'FAILED':
      return 'border-status-danger text-status-danger bg-status-danger/10';
    default:
      return 'border-border-default text-text-muted bg-bg-surface';
  }
}

@Component({
  selector: 'mc-player-worlds-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, McBanner, McButton, McLegalFooter, McPanel],
  template: `
    <div class="relative flex min-h-dvh flex-col bg-bg-canvas text-text-default">
      <header class="border-b-2 border-border-default bg-bg-surface p-4">
        <div class="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <span
              class="size-8 bg-scene-grass shadow-[inset_0_-12px_0_var(--color-scene-dirt)]"
              aria-hidden="true"
            ></span>
            <span class="t-heading-md">mineK8s · Meus mundos</span>
          </div>

          <div class="flex items-center gap-3">
            @if (playerNick(); as nick) {
              <span class="t-caption text-text-muted" data-testid="player-nick">
                Conectado como <strong class="text-text-default">{{ nick }}</strong>
              </span>
            }

            @if (session.isAdmin()) {
              <a
                routerLink="/"
                class="t-button-sm border-2 border-border-default bg-bg-surface px-3 py-1 text-text-default hover:bg-bg-sunken"
                data-testid="admin-dashboard-link"
              >
                Painel admin
              </a>
            }

            <mc-button variant="light" size="sm" (click)="logout()">
              Sair
            </mc-button>
          </div>
        </div>
      </header>

      <main class="mx-auto w-full max-w-4xl flex-1 p-4 py-8">
        <div class="flex flex-col gap-6">
          <div class="flex flex-col gap-1">
            <h1 class="t-display-lg">Mundos liberados</h1>
            <p class="t-body-md text-text-muted">
              Conecte-se aos servidores de Minecraft disponíveis para você na rede Tailscale.
            </p>
          </div>

          @if (error()) {
            <mc-banner tone="danger" title="Não foi possível carregar os mundos">
              {{ error() }}
              <div class="mt-2">
                <mc-button variant="light" size="sm" (click)="loadServers()">Tentar novamente</mc-button>
              </div>
            </mc-banner>
          } @else if (loading()) {
            <mc-panel>
              <p class="t-body-md text-center text-text-muted py-8">Carregando seus mundos…</p>
            </mc-panel>
          } @else if (servers().length === 0) {
            <mc-panel>
              <div class="flex flex-col items-center justify-center gap-2 py-12 text-center" data-testid="empty-worlds">
                <p class="t-heading-md">Nenhum mundo disponível</p>
                <p class="t-body-md text-text-muted max-w-md">
                  Você ainda não tem permissão para nenhum mundo. Peça acesso ao administrador do servidor.
                </p>
              </div>
            </mc-panel>
          } @else {
            <div class="flex flex-col gap-4" data-testid="player-worlds-list">
              @for (server of servers(); track server.address) {
                <mc-panel>
                  <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div class="flex items-center gap-4">
                      @if (server.icon) {
                        <img
                          [src]="server.icon"
                          [alt]="server.name"
                          class="size-16 shrink-0 border-2 border-border-default object-cover"
                        />
                      } @else {
                        <span
                          class="size-16 shrink-0 border-2 border-border-default bg-scene-grass shadow-[inset_0_-24px_0_var(--color-scene-dirt)]"
                          aria-hidden="true"
                        ></span>
                      }

                      <div class="flex flex-col gap-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <h2 class="t-heading-md">{{ server.name }}</h2>
                          <span
                            class="t-caption inline-block border-2 px-2 py-0.5"
                            [class]="getStateClass(server.state)"
                            [attr.data-state]="server.state"
                          >
                            {{ formatState(server.state) }}
                          </span>
                        </div>

                        <p class="t-caption text-text-muted">
                          {{ server.playersOnline }} {{ server.playersOnline === 1 ? 'jogador online' : 'jogadores online' }}
                        </p>

                        <p class="t-body-md font-mono text-text-muted">
                          {{ server.address }}
                        </p>
                      </div>
                    </div>

                    <div class="flex items-center gap-2 sm:self-center">
                      <mc-button
                        variant="neutral"
                        size="sm"
                        (click)="copyAddress(server.address)"
                      >
                        {{ copiedAddress() === server.address ? 'Copiado!' : 'Copiar endereço' }}
                      </mc-button>
                    </div>
                  </div>
                </mc-panel>
              }
            </div>
          }
        </div>
      </main>

      <mc-legal-footer class="relative" />
    </div>
  `,
})
export class PlayerWorldsPage implements OnInit {
  protected readonly session = inject(AuthSession);
  private readonly router = inject(Router);
  private readonly serversApi = inject(ServersApi);

  protected readonly servers = signal<PlayerServer[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly copiedAddress = signal<string | null>(null);

  protected readonly playerNick = computed(() => this.session.user()?.minecraft_nick ?? '');

  ngOnInit(): void {
    this.loadServers();
  }

  loadServers(): void {
    this.loading.set(true);
    this.error.set(null);
    this.serversApi.listMyServers().subscribe({
      next: (data) => {
        this.servers.set(data);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(
          err instanceof Error
            ? err.message
            : 'Erro ao carregar a lista de mundos. Verifique sua conexão e tente novamente.',
        );
      },
    });
  }

  copyAddress(address: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(address);
    }
    this.copiedAddress.set(address);
    setTimeout(() => {
      if (this.copiedAddress() === address) {
        this.copiedAddress.set(null);
      }
    }, 2000);
  }

  logout(): void {
    this.session.logout();
    void this.router.navigateByUrl('/login');
  }

  formatState(state: string): string {
    return formatPlayerServerState(state);
  }

  getStateClass(state: string): string {
    return playerServerStateBadgeClass(state);
  }
}
