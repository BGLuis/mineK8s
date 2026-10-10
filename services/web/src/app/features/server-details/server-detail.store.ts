import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, catchError, exhaustMap, filter, merge, skip, switchMap, tap } from 'rxjs';

import { ServerAccessPolicy, ServerDetail, ServerRuntimeStats } from '../../core/api/models';
import { ServersApi } from '../../core/api/servers.api';
import { ServersSocket } from '../../core/realtime/servers-socket';
import { LifecycleAction, ServerLifecycle } from '../dashboard/server-lifecycle';
import { liveRefresh } from '../dashboard/live-refresh';
import { visiblePoll } from '../dashboard/visible-poll';

const POLL_MS = 5_000;
/** The socket only pushes state transitions; players, uptime and stats change without one. */
const LIVE_POLL_MS = 10_000;
const STATS_REFRESH_MS = 30_000;

export type DetailLoadState = 'loading' | 'ready' | 'error' | 'not-found';

/**
 * State of the open server, shared by the header and the Visão geral / Console tabs.
 * Provided by ServerDetailsPage, so it lives and dies with the route.
 */
@Injectable()
export class ServerDetailStore {
  private readonly api = inject(ServersApi);
  private readonly lifecycle = inject(ServerLifecycle);
  private readonly socket = inject(ServersSocket);

  private readonly id = signal<string | null>(null);
  private readonly refresh$ = new Subject<void>();
  private statsFetchedAt = 0;

  readonly serverId = this.id.asReadonly();
  readonly server = signal<ServerDetail | null>(null);
  readonly loadState = signal<DetailLoadState>('loading');
  /** True when the last poll failed but an older copy of the server is still on screen. */
  readonly stale = signal(false);
  readonly stats = signal<ServerRuntimeStats | null>(null);
  /** Seeded from GET /api/servers/:id and updated right away after a publish/unpublish. */
  readonly accessPolicy = signal<ServerAccessPolicy | null>(null);
  readonly busy = computed(() => {
    const id = this.id();
    return id !== null && this.lifecycle.busy().has(id);
  });

  constructor() {
    toObservable(this.id)
      .pipe(
        filter((id): id is string => id !== null),
        switchMap((id) =>
          merge(
            liveRefresh(this.socket.signals(), POLL_MS, (event) => event.id === id),
            visiblePoll(LIVE_POLL_MS).pipe(skip(1)),
            this.refresh$,
          ).pipe(exhaustMap(() => this.fetch(id))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  watch(id: string): void {
    if (this.id() === id) {
      return;
    }
    this.server.set(null);
    this.stats.set(null);
    this.statsFetchedAt = 0;
    this.accessPolicy.set(null);
    this.stale.set(false);
    this.loadState.set('loading');
    this.id.set(id);
  }

  refresh(): void {
    this.refresh$.next();
  }

  async run(action: LifecycleAction): Promise<void> {
    const server = this.server();
    if (server && (await this.lifecycle.run(action, server))) {
      this.refresh();
    }
  }

  private fetch(id: string) {
    return this.api.get(id).pipe(
      tap((server) => {
        this.server.set(server);
        this.stale.set(false);
        this.loadState.set('ready');
        this.accessPolicy.set(server.access_policy);
        this.syncStats(id, server);
      }),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.server.set(null);
          this.loadState.set('not-found');
        } else if (this.server()) {
          this.stale.set(true);
        } else {
          this.loadState.set('error');
        }
        return EMPTY;
      }),
    );
  }

  /** The agent samples once a minute, so asking on every 5 s refresh would only repeat the answer. */
  private syncStats(id: string, server: ServerDetail): void {
    if (server.state !== 'READY') {
      this.stats.set(null);
      this.statsFetchedAt = 0;
      return;
    }
    if (Date.now() - this.statsFetchedAt < STATS_REFRESH_MS) {
      return;
    }
    this.statsFetchedAt = Date.now();
    this.api.stats(id).subscribe({
      next: (stats) => this.id() === id && this.stats.set(stats),
      error: () => undefined,
    });
  }
}
