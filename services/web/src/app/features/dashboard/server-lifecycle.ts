import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ServersApi } from '../../core/api/servers.api';
import { ToastService } from '../../ui';

export type LifecycleAction = 'start' | 'stop' | 'restart';

const MESSAGES: Record<LifecycleAction, { progress: string; failure: string }> = {
  start: { progress: 'Ligando', failure: 'ligar' },
  stop: { progress: 'Parando', failure: 'parar' },
  restart: { progress: 'Reiniciando', failure: 'reiniciar' },
};

/** Readable reason from an HTTP error, falling back to a generic sentence. */
export function errorReason(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message;
    if (message) {
      return message;
    }
    if (error.status === 0) {
      return 'Sem conexão com o servidor de controle.';
    }
    if (error.status === 403) {
      return 'Você não tem permissão para esta ação.';
    }
  }
  return 'Tente novamente em instantes.';
}

/**
 * Start, stop and restart with a per-server busy flag and toast feedback.
 */
@Injectable({ providedIn: 'root' })
export class ServerLifecycle {
  private readonly api = inject(ServersApi);
  private readonly toast = inject(ToastService);

  private readonly _busy = signal<ReadonlySet<string>>(new Set());
  readonly busy = this._busy.asReadonly();

  /** Resolves true when the action was accepted by the control plane. */
  async run(action: LifecycleAction, server: { id: string; name: string }): Promise<boolean> {
    if (this._busy().has(server.id)) {
      return false;
    }
    this.setBusy(server.id, true);
    try {
      const request =
        action === 'start'
          ? this.api.start(server.id)
          : action === 'stop'
            ? this.api.stop(server.id)
            : this.api.restart(server.id);
      await firstValueFrom(request);
      this.toast.success(`${MESSAGES[action].progress} "${server.name}"…`);
      return true;
    } catch (error) {
      this.toast.error(
        `Não foi possível ${MESSAGES[action].failure} "${server.name}". ${errorReason(error)}`,
      );
      return false;
    } finally {
      this.setBusy(server.id, false);
    }
  }

  private setBusy(id: string, busy: boolean): void {
    this._busy.update((current) => {
      const next = new Set(current);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }
}
