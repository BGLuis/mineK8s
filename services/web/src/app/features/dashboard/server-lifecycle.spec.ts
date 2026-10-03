import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ServersApi } from '../../core/api/servers.api';
import { ToastService } from '../../ui';
import { ServerLifecycle } from './server-lifecycle';

describe('ServerLifecycle', () => {
  const calls: string[] = [];
  let failStart = false;
  let lifecycle: ServerLifecycle;
  let toast: ToastService;

  beforeEach(() => {
    calls.length = 0;
    failStart = false;
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
              return of({ message: 'ok' });
            },
          },
        },
      ],
    });
    lifecycle = TestBed.inject(ServerLifecycle);
    toast = TestBed.inject(ToastService);
  });

  it('restarts as stop followed by start because the API has no restart endpoint', async () => {
    const ok = await lifecycle.run('restart', { id: 's1', name: 'Pixelmon' });

    expect(ok).toBe(true);
    expect(calls).toEqual(['stop:s1', 'start:s1']);
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
});
