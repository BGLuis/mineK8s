import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Socket } from 'socket.io-client';
import { Subject } from 'rxjs';

import { LogEntry } from '../api/models';
import { TokenStore } from '../auth/token-store';
import { RateLimiter } from './rate-limiter';
import { SOCKET_FACTORY, watchVisibility } from './socket-factory';

export const MAX_COMMANDS_PER_SECOND = 5;
const MAX_BUFFERED_LINES = 1000;

export type TerminalStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'unauthorized';

export interface CommandOutput {
  serverId: string;
  command: string;
  output: string;
  durationMs: number;
  error: boolean;
  source?: 'rcon';
}

/**
 * Client for the `/terminal` Socket.IO namespace (terminal.gateway.ts).
 * One active server at a time; the connection pauses while the tab is hidden.
 */
@Injectable({ providedIn: 'root' })
export class TerminalSocket implements OnDestroy {
  private readonly tokens = inject(TokenStore);
  private readonly factory = inject(SOCKET_FACTORY);
  readonly limiter = new RateLimiter(MAX_COMMANDS_PER_SECOND, 1000);
  private readonly stopWatching = watchVisibility(
    () => this.pause(),
    () => this.resume(),
  );

  private socket: Socket | null = null;
  private serverId: string | null = null;
  private paused = false;

  readonly status = signal<TerminalStatus>('idle');
  readonly lines = signal<LogEntry[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly commandOutput = new Subject<CommandOutput>();

  join(serverId: string): void {
    this.leave();
    this.serverId = serverId;
    this.lines.set([]);
    this.errorMessage.set(null);
    this.open();
  }

  leave(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.serverId = null;
    this.paused = false;
    this.status.set('idle');
  }

  /** Returns false when the client-side limit (5 commands/s) rejects the command. */
  sendCommand(command: string): boolean {
    const text = command.trim();
    if (!this.socket || !this.serverId || text === '') {
      return false;
    }
    if (!this.limiter.tryAcquire()) {
      this.errorMessage.set('Muitos comandos seguidos. Aguarde um instante.');
      return false;
    }
    this.socket.emit('send_command', { serverId: this.serverId, command: text });
    return true;
  }

  ngOnDestroy(): void {
    this.stopWatching();
    this.leave();
  }

  private open(): void {
    const socket = this.factory('/terminal', () => this.tokens.token());
    this.socket = socket;
    this.status.set('connecting');

    socket.on('connect', () => {
      this.status.set('connected');
      socket.emit('join_terminal', { serverId: this.serverId });
    });
    socket.on('disconnect', () => {
      if (this.status() !== 'unauthorized') {
        this.status.set('disconnected');
      }
    });
    socket.on('unauthorized', (payload: { message: string }) => {
      this.status.set('unauthorized');
      this.errorMessage.set(payload.message);
    });
    socket.on('error', (payload: { message: string }) => this.errorMessage.set(payload.message));
    socket.on('log_history', (payload: { serverId: string; lines: LogEntry[] }) => {
      if (payload.serverId === this.serverId) {
        this.lines.set(payload.lines.slice(-MAX_BUFFERED_LINES));
      }
    });
    socket.on('log_delta', (payload: { serverId: string; entry: LogEntry }) => {
      if (payload.serverId === this.serverId) {
        this.lines.update((lines) => [...lines, payload.entry].slice(-MAX_BUFFERED_LINES));
      }
    });
    socket.on('command_output', (payload: CommandOutput) => {
      if (payload.serverId === this.serverId) {
        this.commandOutput.next(payload);
      }
    });

    socket.connect();
  }

  private pause(): void {
    if (this.socket && !this.paused) {
      this.paused = true;
      this.socket.disconnect();
    }
  }

  /** Reconnecting re-runs `join_terminal`, which replays `log_history` and fills the gap. */
  private resume(): void {
    if (this.socket && this.paused) {
      this.paused = false;
      this.status.set('connecting');
      this.socket.connect();
    }
  }
}
