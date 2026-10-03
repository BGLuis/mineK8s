import { Injectable, OnDestroy, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Socket } from 'socket.io-client';

import { TaskProgress } from '../api/models';
import { TokenStore } from '../auth/token-store';
import { SOCKET_FACTORY, watchVisibility } from './socket-factory';

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED'];

/**
 * Client for the `/ws/tasks` namespace (tasks.gateway.ts): `subscribeToTask` then `taskProgress`.
 * The connection is shared by all subscriptions and pauses while the tab is hidden.
 */
@Injectable({ providedIn: 'root' })
export class TasksSocket implements OnDestroy {
  private readonly tokens = inject(TokenStore);
  private readonly factory = inject(SOCKET_FACTORY);
  private readonly stopWatching = watchVisibility(
    () => this.socket?.disconnect(),
    () => this.activeTasks.size > 0 && this.socket?.connect(),
  );

  private socket: Socket | null = null;
  private readonly activeTasks = new Set<string>();

  /** Emits progress for one task and completes on COMPLETED or FAILED. Unsubscribing leaves the room. */
  progress(taskId: string): Observable<TaskProgress> {
    return new Observable<TaskProgress>((subscriber) => {
      const socket = this.ensureSocket();
      const onProgress = (payload: TaskProgress) => {
        if (payload.taskId !== taskId) {
          return;
        }
        subscriber.next(payload);
        if (TERMINAL_STATUSES.includes(payload.status)) {
          subscriber.complete();
        }
      };
      socket.on('taskProgress', onProgress);
      this.activeTasks.add(taskId);
      if (socket.connected) {
        socket.emit('subscribeToTask', { taskId });
      } else if (document.visibilityState !== 'hidden') {
        socket.connect();
      }

      return () => {
        socket.off('taskProgress', onProgress);
        this.activeTasks.delete(taskId);
        if (this.activeTasks.size === 0) {
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
      this.socket = this.factory('/ws/tasks', () => this.tokens.token());
      this.socket.on('connect', () => {
        for (const taskId of this.activeTasks) {
          this.socket?.emit('subscribeToTask', { taskId });
        }
      });
    }
    return this.socket;
  }
}
