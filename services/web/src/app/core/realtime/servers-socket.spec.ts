import { TestBed } from '@angular/core/testing';

import { SOCKET_FACTORY } from './socket-factory';
import { ServerSocketSignal, ServersSocket } from './servers-socket';

class FakeSocket {
  connected = false;
  connects = 0;
  disconnects = 0;
  readonly handlers = new Map<string, (payload?: unknown) => void>();
  on(event: string, handler: (payload?: unknown) => void): this {
    this.handlers.set(event, handler);
    return this;
  }
  connect(): this {
    this.connects++;
    return this;
  }
  disconnect(): this {
    this.disconnects++;
    return this;
  }
  receive(event: string, payload?: unknown): void {
    this.handlers.get(event)?.(payload);
  }
}

describe('ServersSocket', () => {
  let fake: FakeSocket;
  let namespaces: string[];
  let servers: ServersSocket;

  beforeEach(() => {
    fake = new FakeSocket();
    namespaces = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SOCKET_FACTORY,
          useValue: (namespace: string) => (namespaces.push(namespace), fake),
        },
      ],
    });
    servers = TestBed.inject(ServersSocket);
  });

  it('opens /ws/servers on subscribe and closes it with the last unsubscribe', () => {
    const first = servers.signals().subscribe();
    const second = servers.signals().subscribe();

    expect(namespaces).toEqual(['/ws/servers']);
    expect(fake.connects).toBeGreaterThan(0);

    first.unsubscribe();
    expect(fake.disconnects).toBe(0);
    second.unsubscribe();
    expect(fake.disconnects).toBe(1);
  });

  it('turns socket events into signals', () => {
    const received: ServerSocketSignal[] = [];
    const subscription = servers.signals().subscribe((signal) => received.push(signal));

    fake.receive('connect');
    fake.receive('serverState', { id: 'srv-1', status: 'READY', is_maintenance: false });
    fake.receive('serverActivity', { id: 'srv-1', kind: 'players' });
    fake.receive('connect_error');
    fake.receive('disconnect');
    subscription.unsubscribe();

    expect(received).toEqual([
      { type: 'connected' },
      { type: 'state', event: { id: 'srv-1', status: 'READY', is_maintenance: false } },
      { type: 'activity', event: { id: 'srv-1', kind: 'players' } },
      { type: 'disconnected' },
      { type: 'disconnected' },
    ]);
  });
});
