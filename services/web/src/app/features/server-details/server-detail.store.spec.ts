import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { ServerDetail, ServerRuntimeStats } from '../../core/api/models';
import { ServersApi } from '../../core/api/servers.api';
import { ServerSocketSignal, ServersSocket } from '../../core/realtime/servers-socket';
import { ServerLifecycle } from '../dashboard/server-lifecycle';
import { ServerDetailStore } from './server-detail.store';

describe('ServerDetailStore', () => {
  const detail = (access_policy: ServerDetail['access_policy']): ServerDetail => ({
    id: 'srv-1',
    name: 'Survival',
    subdomain: 'survival',
    game_type: 'minecraft',
    routing_model: 'sni-shared-port',
    server_type: 'PAPER',
    game_version: '1.21',
    java_version: 21,
    server_build: '130',
    server_build_channel: 'STABLE',
    allocated_memory_mb: 4096,
    allocated_port: null,
    state: 'STOPPED',
    access_policy,
    is_maintenance: false,
    auto_wake: true,
    sleep_timeout_minutes: 15,
    created_at: '',
    updated_at: '',
  });

  const stats: ServerRuntimeStats = {
    window: '60m',
    tps: 19.5,
    mspt: 25,
    memoryUsedMb: 3072,
    memoryLimitMb: 5632,
    uptimeSeconds: 90,
    history: [{ timestamp: '2026-10-09T10:00:00Z', tps: 19.5, mspt: 25, memoryUsedMb: 3072 }],
  };

  function create(
    server: ServerDetail,
    statsCall = vi.fn(() => of(stats)),
    getCall = vi.fn(() => of(server)),
  ) {
    TestBed.configureTestingModule({
      providers: [
        ServerDetailStore,
        { provide: ServersApi, useValue: { get: getCall, stats: statsCall } },
        { provide: ServersSocket, useValue: { signals: () => of({ type: 'connected' }) } },
        { provide: ServerLifecycle, useValue: { busy: signal(new Set<string>()) } },
      ],
    });
    return TestBed.inject(ServerDetailStore);
  }

  it('knows the world is published right after loading it, without a publish in this session', () => {
    const store = create(detail('INTERNET'));

    store.watch('srv-1');
    TestBed.tick();

    expect(store.accessPolicy()).toBe('INTERNET');
  });

  it('reports a private world as private so the dialog offers Publicar', () => {
    const store = create(detail('GROUP'));

    store.watch('srv-1');
    TestBed.tick();

    expect(store.accessPolicy()).toBe('GROUP');
  });

  describe('live refresh', () => {
    const ready = { ...detail('GROUP'), state: 'READY' as const };

    function createWithSignals(signals: Subject<ServerSocketSignal>, get: () => unknown) {
      TestBed.configureTestingModule({
        providers: [
          ServerDetailStore,
          { provide: ServersApi, useValue: { get, stats: () => of(stats) } },
          { provide: ServersSocket, useValue: { signals: () => signals } },
          { provide: ServerLifecycle, useValue: { busy: signal(new Set<string>()) } },
        ],
      });
      return TestBed.inject(ServerDetailStore);
    }

    afterEach(() => vi.useRealTimers());

    it('reloads the open server when the control plane pushes activity for it, and only for it', async () => {
      vi.useFakeTimers();
      const signals = new Subject<ServerSocketSignal>();
      const get = vi.fn(() => of(ready));
      const store = createWithSignals(signals, get);

      store.watch('srv-1');
      TestBed.tick();
      signals.next({ type: 'connected' });
      await vi.advanceTimersByTimeAsync(0);
      get.mockClear();

      signals.next({ type: 'activity', event: { id: 'srv-2', kind: 'players' } });
      await vi.advanceTimersByTimeAsync(300);
      expect(get).not.toHaveBeenCalled();

      signals.next({ type: 'activity', event: { id: 'srv-1', kind: 'players' } });
      await vi.advanceTimersByTimeAsync(300);
      expect(get).toHaveBeenCalledTimes(1);
    });

    it('does not poll while the socket is connected', async () => {
      vi.useFakeTimers();
      const signals = new Subject<ServerSocketSignal>();
      const get = vi.fn(() => of(ready));
      const store = createWithSignals(signals, get);

      store.watch('srv-1');
      TestBed.tick();
      signals.next({ type: 'connected' });
      await vi.advanceTimersByTimeAsync(0);
      get.mockClear();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('runtime stats', () => {
    const ready = { ...detail('GROUP'), state: 'READY' as const };

    it('loads the stats of a running server from the API', () => {
      const statsCall = vi.fn(() => of(stats));
      const store = create(ready, statsCall);

      store.watch('srv-1');
      TestBed.tick();

      expect(statsCall).toHaveBeenCalledWith('srv-1');
      expect(store.stats()).toEqual(stats);
    });

    it('does not ask for stats of a server that is not running', () => {
      const statsCall = vi.fn(() => of(stats));
      const store = create(detail('GROUP'), statsCall);

      store.watch('srv-1');
      TestBed.tick();

      expect(statsCall).not.toHaveBeenCalled();
      expect(store.stats()).toBeNull();
    });

    it('keeps the page working when the stats request fails', () => {
      const store = create(
        ready,
        vi.fn(() => throwError(() => new Error('boom'))),
      );

      store.watch('srv-1');
      TestBed.tick();

      expect(store.server()?.id).toBe('srv-1');
      expect(store.stats()).toBeNull();
    });
  });
});
