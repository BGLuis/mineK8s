import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';

import { UserRole } from '../../core/api/models';
import { McIcon } from '../icon/icon';
import { McPlayerHead } from '../player-head/player-head';
import { IconName } from '../icon/icon-registry';

export interface SidebarUser {
  nick: string;
  role: UserRole;
}

export interface SidebarTailnet {
  used: number;
  limit: number;
}

interface NavEntry {
  label: string;
  short: string;
  link: string;
  icon: IconName;
  isActive: (url: string) => boolean;
}

const path = (url: string): string => url.split(/[?#]/)[0];

export const NAV_ENTRIES: readonly NavEntry[] = [
  {
    label: 'Dashboard',
    short: 'Mundos',
    link: '/',
    icon: 'grid',
    isActive: (url) =>
      path(url) === '/' || (path(url).startsWith('/servers/') && path(url) !== '/servers/new'),
  },
  {
    label: 'Criar servidor',
    short: 'Criar',
    link: '/servers/new',
    icon: 'pickaxe',
    isActive: (url) => path(url) === '/servers/new',
  },
  {
    label: 'Convidados e acesso',
    short: 'Acesso',
    link: '/access',
    icon: 'character',
    isActive: (url) => path(url).startsWith('/access'),
  },
  {
    label: 'Saúde do sistema',
    short: 'Saúde',
    link: '/health',
    icon: 'stats',
    isActive: (url) => path(url).startsWith('/health'),
  },
  {
    label: 'Configurações',
    short: 'Ajustes',
    link: '/settings',
    icon: 'settings',
    isActive: (url) => path(url).startsWith('/settings'),
  },
];

const ROLE_LABELS: Record<UserRole, string> = { ADMIN: 'Administrador', PLAYER: 'Jogador' };

/**
 * Navigation: a fixed sidebar from 768 px up; below that a top bar plus a bottom tab bar.
 * Render it once per layout, next to a main area that reserves the matching space.
 */
@Component({
  selector: 'mc-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McIcon, McPlayerHead, RouterLink],
  host: { class: 'contents' },
  template: `
    <aside
      class="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-6 border-r-2 border-border-strong bg-surface-default p-4 md:flex"
      aria-label="Navegação principal"
    >
      <a routerLink="/" class="flex items-center gap-3 px-2 py-1">
        <span
          class="size-8 bg-scene-grass shadow-[inset_0_-12px_0_var(--color-scene-dirt)]"
          aria-hidden="true"
        ></span>
        <span class="t-title-md">mineK8s</span>
      </a>

      <nav aria-label="Seções">
        <ul class="flex flex-col gap-2">
          @for (entry of entries; track entry.link) {
            <li>
              <a
                class="t-label-md flex h-12 items-center gap-3 border-l-4 px-3"
                [class]="
                  isActive(entry)
                    ? 'border-border-focus bg-surface-hover text-text-primary'
                    : 'border-transparent text-text-muted hover:bg-surface-hover hover:text-text-primary'
                "
                [routerLink]="entry.link"
                [attr.aria-current]="isActive(entry) ? 'page' : null"
              >
                <mc-icon
                  [name]="entry.icon"
                  [size]="24"
                  [class]="isActive(entry) ? 'text-border-focus' : ''"
                />
                {{ entry.label }}
              </a>
            </li>
          }
        </ul>
      </nav>

      <div class="mt-auto flex flex-col gap-4">
        @if (tailnet(); as quota) {
          <div class="bevel-sunken flex flex-col gap-1 bg-bg-sunken p-3">
            <p class="t-caption text-text-muted">Rede Tailscale</p>
            <p class="t-body-strong">{{ quota.used }} de {{ quota.limit }} dispositivos</p>
          </div>
        }
        @if (user(); as current) {
          <div class="flex items-center gap-3">
            <mc-player-head class="bg-action-primary" [nick]="current.nick" />
            <div class="min-w-0 flex-1">
              <p class="t-body-strong truncate">{{ current.nick }}</p>
              <p class="t-caption text-text-muted">{{ roleLabel() }}</p>
            </div>
            <button
              type="button"
              class="inline-flex size-10 shrink-0 items-center justify-center text-text-muted hover:text-text-primary"
              aria-label="Sair"
              (click)="logout.emit()"
            >
              <mc-icon name="power-off" [size]="24" />
            </button>
          </div>
        }
      </div>
    </aside>

    <header
      class="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b-2 border-border-strong bg-surface-default px-4 md:hidden"
    >
      <a routerLink="/" class="flex items-center gap-2">
        <span
          class="size-6 bg-scene-grass shadow-[inset_0_-8px_0_var(--color-scene-dirt)]"
          aria-hidden="true"
        ></span>
        <span class="t-title-sm">mineK8s</span>
      </a>
      @if (user(); as current) {
        <button
          type="button"
          class="inline-flex"
          [attr.aria-label]="'Sair (' + current.nick + ')'"
          (click)="logout.emit()"
        >
          <mc-player-head class="bg-action-primary" [nick]="current.nick" />
        </button>
      }
    </header>

    <nav
      class="fixed inset-x-0 bottom-0 z-30 border-t-2 border-border-strong bg-surface-default md:hidden"
      aria-label="Seções"
    >
      <ul class="grid grid-cols-5">
        @for (entry of entries; track entry.link) {
          <li>
            <a
              class="t-button-sm flex h-16 flex-col items-center justify-center gap-1 border-t-4"
              [class]="
                isActive(entry)
                  ? 'border-border-focus text-border-focus'
                  : 'border-transparent text-text-muted'
              "
              [routerLink]="entry.link"
              [attr.aria-current]="isActive(entry) ? 'page' : null"
            >
              <mc-icon [name]="entry.icon" [size]="24" />
              {{ entry.short }}
            </a>
          </li>
        }
      </ul>
    </nav>
  `,
})
export class McSidebar {
  private readonly router = inject(Router);

  readonly user = input<SidebarUser | null>(null);
  readonly tailnet = input<SidebarTailnet | null>(null);
  readonly logout = output<void>();

  protected readonly entries = NAV_ENTRIES;
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly roleLabel = computed(() => ROLE_LABELS[this.user()?.role ?? 'PLAYER']);

  protected isActive(entry: NavEntry): boolean {
    return entry.isActive(this.url());
  }
}
