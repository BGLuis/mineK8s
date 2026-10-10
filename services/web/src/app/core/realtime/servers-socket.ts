import { Injectable, OnDestroy, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Socket } from 'socket.io-client';

import { TokenStore } from '../auth/token-store';
import { SOCKET_FACTORY, watchVisibility } from './socket-factory';

/** Payload of `serverState` on `/ws/servers` (servers-state.gateway.ts). */
export interface ServerStateEvent {
  id: string;
  status: string;
  is_maintenance: boolean;
}

/** Payload of `serverActivity` (server-activity.bus.ts): that part of the server changed, reload it. */
export interface ServerActivityEvent {
  id: string;
  kind: 'players' | 'backups' | 'stats';
}

export type ServerSocketSignal =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'state'; event: ServerStateEvent }
  | { type: 'activity'; event: ServerActivityEvent };

/**
 * Client for the `/ws/servers` namespace. The connection is opened while something is subscribed
 * to `signals()` and pauses while the tab is hidden (RF-ARQ-27).
 */
@Injectable({ providedIn: 'root' })
export class ServersSocket implements OnDestroy {
  private readonly tokens = inject(TokenStore);
  private readonly factory = inject(SOCKET_FACTORY);
  private readonly stopWatching = watchVisibility(
    () => this.socket?.disconnect(),
    () => this.listeners > 0 && this.socket?.connect(),
  );

  private socket: Socket | null = null;
  private listeners = 0;
  private readonly bus = new Subject<ServerSocketSignal>();

  /** Connection changes and state events. Subscribing opens the socket; the last unsubscribe closes it. */
  signals(): Observable<ServerSocketSignal> {
    return new Observable<ServerSocketSignal>((subscriber) => {
      const inner = this.bus.subscribe(subscriber);
      const socket = this.ensureSocket();
      this.listeners++;
      if (socket.connected) {
        subscriber.next({ type: 'connected' });
      } else if (document.visibilityState !== 'hidden') {
        socket.connect();
      }

      return () => {
        inner.unsubscribe();
        this.listeners--;
        if (this.listeners === 0) {
          socket.disconnect();
        }
      };
    });
  }

  ngOnDestroy(): void {
    this.stopWatching();
    this.socket?.disconnect();
  }

  private ensureSocket(): Socket {
    if (!this.socket) {
      const socket = this.factory('/ws/servers', () => this.tokens.token());
      socket.on('connect', () => this.bus.next({ type: 'connected' }));
      socket.on('disconnect', () => this.bus.next({ type: 'disconnected' }));
      socket.on('connect_error', () => this.bus.next({ type: 'disconnected' }));
      socket.on('serverState', (event: ServerStateEvent) =>
        this.bus.next({ type: 'state', event }),
      );
      socket.on('serverActivity', (event: ServerActivityEvent) =>
        this.bus.next({ type: 'activity', event }),
      );
      this.socket = socket;
    }
    return this.socket;
  }
}
