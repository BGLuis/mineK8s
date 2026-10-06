import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterOutlet } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { NodeApi } from '../core/api/node.api';
import { AuthSession } from '../core/auth/auth-session';
import { McLegalFooter, McSidebar } from '../ui';

/** Authenticated layout: sidebar (or top and bottom bars on mobile), main area and legal footer. */
@Component({
  selector: 'mc-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McSidebar, McLegalFooter, RouterOutlet],
  template: `
    <mc-sidebar
      [user]="sidebarUser()"
      [tailnet]="tailnet()"
      (logout)="logout()"
    />
    <div class="flex min-h-dvh flex-col pt-14 pb-16 md:pt-0 md:pb-0 md:pl-64">
      <main class="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8" id="main">
        <router-outlet />
      </main>
      <mc-legal-footer />
    </div>
  `,
})
export class ShellComponent {
  private readonly session = inject(AuthSession);
  private readonly router = inject(Router);
  private readonly nodeApi = inject(NodeApi);

  protected readonly sidebarUser = computed(() => {
    const user = this.session.user();
    return user ? { nick: user.minecraft_nick, role: user.role } : null;
  });
  protected readonly tailnet = toSignal(
    this.nodeApi.metrics().pipe(
      map(({ tailnet }) => ({ used: tailnet.active, limit: tailnet.limit })),
      catchError(() => of(null)),
    ),
    { initialValue: null },
  );

  protected logout(): void {
    this.session.logout();
    void this.router.navigate(['/login']);
  }
}
