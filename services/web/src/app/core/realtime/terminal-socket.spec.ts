import { TestBed } from '@angular/core/testing';
import { Socket } from 'socket.io-client';

import { RateLimiter } from './rate-limiter';
import { SOCKET_FACTORY } from './socket-factory';
import { MAX_COMMANDS_PER_SECOND, TerminalSocket } from './terminal-socket';

class FakeSocket {
  readonly emitted: { event: string; payload: unknown }[] = [];
  disconnects = 0;
  connects = 0;
  private readonly handlers = new Map<string, (payload?: unknown) => void>();

  on(event: string, handler: (payload?: unknown) => void): this {
    this.handlers.set(event, handler);
    return this;
  }
  emit(event: string, payload?: unknown): this {
    this.emitted.push({ event, payload });
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
  sent(event: string): unknown[] {
    return this.emitted.filter((e) => e.event === event).map((e) => e.payload);
  }
}

describe('RateLimiter', () => {
  it('allows `max` acquisitions per window and rejects the next one', () => {
    const limiter = new RateLimiter(5, 1000);
    const results = Array.from({ length: 6 }, () => limiter.tryAcquire(0));

    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it('slides the window instead of resetting it', () => {
    const limiter = new RateLimiter(2, 1000);
    limiter.tryAcquire(0);
    limiter.tryAcquire(600);

    expect(limiter.tryAcquire(999)).toBe(false);
    expect(limiter.tryAcquire(1000)).toBe(true);
    expect(limiter.tryAcquire(1001)).toBe(false);
  });
});

describe('TerminalSocket', () => {
  let fake: FakeSocket;
  let terminal: TerminalSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    fake = new FakeSocket();
    TestBed.configureTestingModule({
      providers: [{ provide: SOCKET_FACTORY, useValue: () => fake as unknown as Socket }],
    });
    terminal = TestBed.inject(TerminalSocket);
    terminal.join('srv-1');
    fake.receive('connect');
  });

  afterEach(() => vi.useRealTimers());

  it('is limited to 5 commands per second on the client', () => {
    expect(MAX_COMMANDS_PER_SECOND).toBe(5);

    const accepted = Array.from({ length: 6 }, (_, i) => terminal.sendCommand(`say ${i}`));

    expect(accepted).toEqual([true, true, true, true, true, false]);
    expect(fake.sent('send_command')).toHaveLength(5);
    expect(terminal.errorMessage()).toContain('Muitos comandos');
  });

  it('accepts commands again once the window has passed', () => {
    for (let i = 0; i < 5; i++) {
      terminal.sendCommand('list');
    }
    vi.advanceTimersByTime(1000);

    expect(terminal.sendCommand('list')).toBe(true);
    expect(fake.sent('send_command')).toHaveLength(6);
  });

  it('sends the server id with each command and ignores blank input', () => {
    expect(terminal.sendCommand('   ')).toBe(false);
    terminal.sendCommand('  list ');

    expect(fake.sent('send_command')).toEqual([{ serverId: 'srv-1', command: 'list' }]);
  });

  it('joins the terminal room on connect and fills the buffer from log_history and log_delta', () => {
    expect(fake.sent('join_terminal')).toEqual([{ serverId: 'srv-1' }]);

    const entry = (id: string) => ({
      id,
      timestamp: '2026-10-02T12:00:00Z',
      level: 'INFO',
      message: id,
    });
    fake.receive('log_history', { serverId: 'srv-1', lines: [entry('a'), entry('b')] });
    fake.receive('log_delta', { serverId: 'srv-1', entry: entry('c') });
    fake.receive('log_delta', { serverId: 'other', entry: entry('x') });

    expect(terminal.lines().map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('pauses while the tab is hidden and reconnects when it is visible again', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');

    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fake.disconnects).toBe(1);

    const connectsBefore = fake.connects;
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fake.connects).toBe(connectsBefore + 1);
  });

  it('flags the session as unauthorized when the gateway rejects the handshake', () => {
    fake.receive('unauthorized', { message: 'Credenciais ausentes ou inválidas' });
    fake.receive('disconnect');

    expect(terminal.status()).toBe('unauthorized');
  });
});
