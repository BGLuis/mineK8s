import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { TaskProgress } from '../../core/api/models';
import { ServersApi } from '../../core/api/servers.api';
import { TasksSocket } from '../../core/realtime/tasks-socket';
import { ToastService } from '../../ui';
import { ServerLifecycle } from './server-lifecycle';

describe('ServerLifecycle', () => {
  const calls: string[] = [];
  let failStart = false;
  let failCancel = false;
  let lifecycle: ServerLifecycle;
  let toast: ToastService;
  const progressSubject = new Subject<TaskProgress>();

  beforeEach(() => {
    calls.length = 0;
    failStart = false;
    failCancel = false;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ServersApi,
          useValue: {
            start: (id: string) => {
              calls.push(`start:${id}`);
              return failStart ? throwError(() => new Error('boom')) : of({ message: 'ok' });
            },
            stop: (id: string) => {
              calls.push(`stop:${id}`);
              return of({ message: 'ok', taskId: 'task-1' });
            },
            restart: (id: string) => {
              calls.push(`restart:${id}`);
              return of({ message: 'ok' });
            },
            cancelStop: (id: string) => {
              calls.push(`cancelStop:${id}`);
              return failCancel
                ? throwError(() => new Error('cancel failed'))
                : of({ message: 'ok' });
            },
          },
        },
        {
          provide: TasksSocket,
          useValue: {
            progress: () => progressSubject.asObservable(),
          },
        },
      ],
    });
    lifecycle = TestBed.inject(ServerLifecycle);
    toast = TestBed.inject(ToastService);
  });

  it('restarts through the dedicated endpoint so the control plane keeps the graceful shutdown', async () => {
    const ok = await lifecycle.run('restart', { id: 's1', name: 'Pixelmon' });

    expect(ok).toBe(true);
    expect(calls).toEqual(['restart:s1']);
  });

  it('clears the busy flag and reports an error toast when the call fails', async () => {
    failStart = true;

    const ok = await lifecycle.run('start', { id: 's1', name: 'Criativo' });

    expect(ok).toBe(false);
    expect(lifecycle.busy().has('s1')).toBe(false);
    const [last] = toast.toasts().slice(-1);
    expect(last.tone).toBe('danger');
    expect(last.message).toContain('Criativo');
  });

  it('ignores a second action on the same server while one is in flight', async () => {
    const first = lifecycle.run('stop', { id: 's1', name: 'A' });
    expect(lifecycle.busy().has('s1')).toBe(true);

    expect(await lifecycle.run('stop', { id: 's1', name: 'A' })).toBe(false);
    await first;

    expect(calls).toEqual(['stop:s1']);
  });

  it('tracks task progress until completion when a taskId is returned', async () => {
    await lifecycle.run('stop', { id: 's1', name: 'Survival' });

    expect(lifecycle.activeTaskFor('s1')).toEqual({
      serverId: 's1',
      taskId: 'task-1',
      action: 'stop',
      step: 'Aguardando contagem regressiva…',
      progressPercent: 0,
    });

    progressSubject.next({
      taskId: 'task-1',
      serverId: 's1',
      status: 'RUNNING',
      currentStep: 'Avisando jogadores…',
      progressPercent: 50,
      downloadedFiles: 0,
      totalFiles: 0,
    });

    expect(lifecycle.activeTaskFor('s1')?.step).toBe('Avisando jogadores…');
    expect(lifecycle.activeTaskFor('s1')?.progressPercent).toBe(50);

    progressSubject.next({
      taskId: 'task-1',
      serverId: 's1',
      status: 'COMPLETED',
      currentStep: 'Finalizado',
      progressPercent: 100,
      downloadedFiles: 0,
      totalFiles: 0,
    });

    expect(lifecycle.activeTaskFor('s1')).toBeUndefined();
  });

  it('cancels stop through cancel endpoint and clears active task', async () => {
    await lifecycle.run('stop', { id: 's1', name: 'Survival' });
    expect(lifecycle.activeTaskFor('s1')).toBeDefined();

    const ok = await lifecycle.cancel('s1');

    expect(ok).toBe(true);
    expect(calls).toContain('cancelStop:s1');
    expect(lifecycle.activeTaskFor('s1')).toBeUndefined();
    const [last] = toast.toasts().slice(-1);
    expect(last.tone).toBe('success');
  });

  it('tracks task via public trackTask and deduplicates existing subscriptions (#204)', () => {
    lifecycle.trackTask('s2', 'task-update-1', 'update-version');
    expect(lifecycle.activeTaskFor('s2')).toEqual({
      serverId: 's2',
      taskId: 'task-update-1',
      action: 'update-version',
      step: 'Aguardando contagem regressiva…',
      progressPercent: 0,
    });

    // Calling again does not overwrite or create duplicate subscription
    lifecycle.trackTask('s2', 'task-update-1', 'update-version');
    expect(lifecycle.activeTaskFor('s2')?.taskId).toBe('task-update-1');
  });
});
