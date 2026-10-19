import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ServersApi } from '../../core/api/servers.api';
import { errorReason } from '../../core/api/api-error';
import { TasksSocket } from '../../core/realtime/tasks-socket';
import { ToastService } from '../../ui';

export type LifecycleAction = 'start' | 'stop' | 'restart' | 'update-version';

export interface ActiveServerTask {
  serverId: string;
  taskId: string;
  action: LifecycleAction;
  step: string;
  progressPercent: number;
}

const MESSAGES: Record<LifecycleAction, { progress: string; failure: string }> = {
  start: { progress: 'Ligando', failure: 'ligar' },
  stop: { progress: 'Parando', failure: 'parar' },
  restart: { progress: 'Reiniciando', failure: 'reiniciar' },
  'update-version': { progress: 'Atualizando versão de', failure: 'atualizar versão de' },
};

export { errorReason };

/**
 * Start, stop and restart with a per-server busy flag, task progress tracking and toast feedback.
 */
@Injectable({ providedIn: 'root' })
export class ServerLifecycle {
  private readonly api = inject(ServersApi);
  private readonly toast = inject(ToastService);
  private readonly tasksSocket = inject(TasksSocket);

  private readonly _busy = signal<ReadonlySet<string>>(new Set());
  readonly busy = this._busy.asReadonly();

  private readonly _activeTasks = signal<ReadonlyMap<string, ActiveServerTask>>(new Map());
  readonly activeTasks = this._activeTasks.asReadonly();

  activeTaskFor(serverId: string): ActiveServerTask | undefined {
    return this._activeTasks().get(serverId);
  }

  /** Resolves true when the action was accepted by the control plane. */
  async run(
    action: LifecycleAction,
    server: { id: string; name: string },
    warningMinutes?: number,
  ): Promise<boolean> {
    if (this._busy().has(server.id)) {
      return false;
    }
    this.setBusy(server.id, true);
    try {
      const request =
        action === 'start'
          ? this.api.start(server.id)
          : action === 'stop'
            ? this.api.stop(
                server.id,
                warningMinutes !== undefined ? { warning_minutes: warningMinutes } : undefined,
              )
            : this.api.restart(
                server.id,
                warningMinutes !== undefined ? { warning_minutes: warningMinutes } : undefined,
              );
      const res = await firstValueFrom(request);

      if (res && 'taskId' in res && typeof res.taskId === 'string') {
        this.trackTask(server.id, res.taskId, action);
      }

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

  async cancel(serverId: string): Promise<boolean> {
    try {
      await firstValueFrom(this.api.cancelStop(serverId));
      this.toast.success('Parada do servidor cancelada.');
      this.removeActiveTask(serverId);
      return true;
    } catch (error) {
      this.toast.error(`Não foi possível cancelar a parada. ${errorReason(error)}`);
      return false;
    }
  }

  trackTask(serverId: string, taskId: string, action: LifecycleAction): void {
    const existing = this._activeTasks().get(serverId);
    if (existing && existing.taskId === taskId) {
      return;
    }
    const initial: ActiveServerTask = {
      serverId,
      taskId,
      action,
      step: 'Aguardando contagem regressiva…',
      progressPercent: 0,
    };
    this.setActiveTask(serverId, initial);

    const sub = this.tasksSocket.progress(taskId).subscribe({
      next: (payload) => {
        if (payload.status === 'COMPLETED' || payload.status === 'FAILED') {
          this.removeActiveTask(serverId);
          sub.unsubscribe();
        } else {
          this.setActiveTask(serverId, {
            serverId,
            taskId,
            action,
            step: payload.currentStep,
            progressPercent: payload.progressPercent,
          });
        }
      },
      error: () => {
        this.removeActiveTask(serverId);
        sub.unsubscribe();
      },
      complete: () => {
        this.removeActiveTask(serverId);
      },
    });
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

  private setActiveTask(serverId: string, task: ActiveServerTask): void {
    this._activeTasks.update((current) => {
      const next = new Map(current);
      next.set(serverId, task);
      return next;
    });
  }

  private removeActiveTask(serverId: string): void {
    this._activeTasks.update((current) => {
      const next = new Map(current);
      next.delete(serverId);
      return next;
    });
  }
}
