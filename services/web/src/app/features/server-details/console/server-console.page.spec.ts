import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Socket } from 'socket.io-client';

import { SOCKET_FACTORY } from '../../../core/realtime/socket-factory';
import { ToastService } from '../../../ui';
import { ServerDetailStore } from '../server-detail.store';
import { ServerConsolePage } from './server-console.page';

class FakeSocket {
  readonly emitted: { event: string; payload: unknown }[] = [];
  disconnects = 0;
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
    return this;
  }
  disconnect(): this {
    this.disconnects++;
    return this;
  }
  receive(event: string, payload?: unknown): void {
    this.handlers.get(event)?.(payload);
  }
  commands(): string[] {
    return this.emitted
      .filter((e) => e.event === 'send_command')
      .map((e) => (e.payload as { command: string }).command);
  }
}

/** Fake timers freeze Angular's zoneless scheduler, so change detection is driven by hand. */
async function settle(fixture: ComponentFixture<unknown>, ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  fixture.detectChanges();
}

describe('ServerConsolePage rate limit', () => {
  let socket: FakeSocket;
  let el: HTMLElement;
  let toast: ToastService;
  let serverState = signal('READY');

  const shortcut = (label: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)!;
  const enviar = () => shortcut('Enviar');

  async function render() {
    serverState = signal('READY');
    socket = new FakeSocket();
    TestBed.configureTestingModule({
      providers: [
        { provide: SOCKET_FACTORY, useValue: () => socket as unknown as Socket },
        {
          provide: ServerDetailStore,
          useValue: {
            serverId: signal('srv-1'),
            server: signal({ id: 'srv-1', name: 'Sobrevivência', state: 'READY' }),
          },
        },
      ],
    });
    toast = TestBed.inject(ToastService);
    const fixture = TestBed.createComponent(ServerConsolePage);
    el = fixture.nativeElement;
    await settle(fixture);
    socket.receive('connect');
    await settle(fixture);
    return fixture;
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('joins the terminal of the open server on enter and leaves it on destroy', async () => {
    const fixture = await render();

    expect(socket.emitted).toContainEqual({
      event: 'join_terminal',
      payload: { serverId: 'srv-1' },
    });

    fixture.destroy();
    expect(socket.disconnects).toBe(1);
  });

  it('disables Enviar and the shortcuts, with a toast, once 5 commands went out in a second', async () => {
    const fixture = await render();
    const shortcuts = ['/save-all', '/time set day', '/weather clear', '/whitelist list', '/list'];

    for (const label of shortcuts.slice(0, 4)) {
      shortcut(label).click();
      await settle(fixture);
    }
    expect(toast.toasts()).toHaveLength(0);

    shortcut('/list').click();
    await settle(fixture);

    expect(socket.commands()).toEqual([
      'save-all',
      'time set day',
      'weather clear',
      'whitelist list',
      'list',
    ]);
    expect(toast.toasts().map((t) => t.message)).toEqual([
      expect.stringContaining('5 comandos por segundo'),
    ]);
    expect(shortcut('/list').disabled).toBe(true);
    expect(el.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);

    shortcut('/list').click();
    expect(socket.commands()).toHaveLength(5);
  });

  it('re-enables sending after the one second window passes', async () => {
    const fixture = await render();
    for (let i = 0; i < 5; i++) {
      shortcut('/list').click();
      await settle(fixture);
    }
    expect(shortcut('/list').disabled).toBe(true);

    await settle(fixture, 1000);

    expect(shortcut('/list').disabled).toBe(false);
    shortcut('/list').click();
    expect(socket.commands()).toHaveLength(6);
  });

  it('keeps Enviar disabled and explains why while the server is not running', async () => {
    TestBed.resetTestingModule();
    socket = new FakeSocket();
    TestBed.configureTestingModule({
      providers: [
        { provide: SOCKET_FACTORY, useValue: () => socket as unknown as Socket },
        {
          provide: ServerDetailStore,
          useValue: {
            serverId: signal('srv-1'),
            server: signal({ id: 'srv-1', name: 'Criativo', state: 'STOPPED' }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ServerConsolePage);
    el = fixture.nativeElement;
    await settle(fixture);
    socket.receive('connect');
    await settle(fixture);

    expect(el.textContent).toContain('Servidor fora do ar');
    expect(shortcut('/list').disabled).toBe(true);
  });

  it('shows the unauthorized state when the gateway rejects the session', async () => {
    const fixture = await render();

    socket.receive('unauthorized', { message: 'Credenciais ausentes ou inválidas' });
    socket.receive('disconnect');
    await settle(fixture);

    expect(el.textContent).toContain('Sem permissão para o console');
    expect(el.textContent).toContain('Credenciais ausentes ou inválidas');
    expect(enviar().disabled).toBe(true);
  });

  it('does not display the no-api-tag for stdout x RCON', async () => {
    await render();
    expect(el.textContent).not.toContain('stdout × RCON');
  });
});
