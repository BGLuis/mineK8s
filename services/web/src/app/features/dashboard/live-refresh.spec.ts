import { Subject } from 'rxjs';

import { ServerSocketSignal } from '../../core/realtime/servers-socket';
import { liveRefresh } from './live-refresh';

const state = (id: string, status = 'READY'): ServerSocketSignal => ({
  type: 'state',
  event: { id, status, is_maintenance: false },
});

describe('liveRefresh', () => {
  let signals: Subject<ServerSocketSignal>;
  let reloads: number;

  beforeEach(() => {
    vi.useFakeTimers();
    signals = new Subject();
    reloads = 0;
  });

  afterEach(() => vi.useRealTimers());

  const watch = (accept?: (event: { id: string }) => boolean) =>
    liveRefresh(signals, 10_000, accept as never).subscribe(() => reloads++);

  it('polls like before while the socket is down', async () => {
    watch();
    await vi.advanceTimersByTimeAsync(0);
    expect(reloads).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(reloads).toBe(2);
  });

  it('stops polling once the socket connects and reloads once to catch up', async () => {
    watch();
    await vi.advanceTimersByTimeAsync(0);
    reloads = 0;

    signals.next({ type: 'connected' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(reloads).toBe(1);
  });

  it('reloads on a pushed transition, without waiting for a poll', async () => {
    watch();
    signals.next({ type: 'connected' });
    await vi.advanceTimersByTimeAsync(0);
    reloads = 0;

    signals.next(state('srv-1', 'STARTING'));
    await vi.advanceTimersByTimeAsync(200);

    expect(reloads).toBe(1);
  });

  it('collapses a burst of transitions into one reload', async () => {
    watch();
    signals.next({ type: 'connected' });
    await vi.advanceTimersByTimeAsync(0);
    reloads = 0;

    signals.next(state('srv-1', 'STARTING'));
    signals.next(state('srv-2', 'READY'));
    signals.next(state('srv-1', 'READY'));
    await vi.advanceTimersByTimeAsync(200);

    expect(reloads).toBe(1);
  });

  it('ignores transitions of servers the screen does not show', async () => {
    watch((event) => event.id === 'srv-1');
    signals.next({ type: 'connected' });
    await vi.advanceTimersByTimeAsync(0);
    reloads = 0;

    signals.next(state('srv-2'));
    await vi.advanceTimersByTimeAsync(200);

    expect(reloads).toBe(0);
  });

  it('goes back to polling when the socket drops', async () => {
    watch();
    signals.next({ type: 'connected' });
    await vi.advanceTimersByTimeAsync(0);
    reloads = 0;

    signals.next({ type: 'disconnected' });
    await vi.advanceTimersByTimeAsync(0);
    expect(reloads).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(reloads).toBe(2);
  });
});
