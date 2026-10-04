import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ServerDetail } from '../../core/api/models';
import { ServersApi } from '../../core/api/servers.api';
import { ServersSocket } from '../../core/realtime/servers-socket';
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

  function create(server: ServerDetail) {
    TestBed.configureTestingModule({
      providers: [
        ServerDetailStore,
        { provide: ServersApi, useValue: { get: () => of(server) } },
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
});
