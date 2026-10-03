import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { MockApi } from '../../core/api/mock-api';
import { ServerState, ServerSummary } from '../../core/api/models';
import { ServersApi } from '../../core/api/servers.api';
import { TailscaleApi } from '../../core/api/tailscale.api';
import { DashboardPage } from './dashboard.page';

const server = (id: string, name: string, state: ServerState): ServerSummary => ({
  id,
  name,
  subdomain: id,
  game_type: 'minecraft',
  routing_model: 'sni-shared-port',
  server_type: 'PAPER',
  game_version: '1.21.1',
  allocated_memory_mb: 4096,
  allocated_port: null,
  state,
  is_maintenance: false,
  auto_wake: true,
  sleep_timeout_minutes: 15,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

describe('DashboardPage', () => {
  const started: string[] = [];
  const stopped: string[] = [];
  const restarted: string[] = [];

  async function render(servers: ServerSummary[], devices: { status: string }[] = []) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ServersApi,
          useValue: {
            list: () => of(servers),
            start: (id: string) => (started.push(id), of({ message: 'ok' })),
            stop: (id: string) => (stopped.push(id), of({ message: 'ok' })),
            restart: (id: string) => (restarted.push(id), of({ message: 'ok' })),
          },
        },
        { provide: TailscaleApi, useValue: { listDevices: () => of(devices) } },
        {
          provide: MockApi,
          useValue: {
            nodeMetrics: () =>
              of({
                cpuPercent: 42,
                cpuLabel: 'cpu',
                ramPercent: 50,
                ramLabel: 'ram',
                nvmePercent: 63,
                nvmeLabel: 'nvme',
                tailnetDevices: { used: 0, limit: 50 },
              }),
            diskAlerts: () => of([{ level: 'warning', percent: 78 }]),
            serverPlayers: () => of({ online: 3, max: 20, players: [] }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(DashboardPage);
    await vi.advanceTimersByTimeAsync(0);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const buttons = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('mc-server-card')).map((card) =>
      Array.from(card.querySelectorAll('button'))
        .map((b) => b.textContent?.trim())
        .join('|'),
    );

  beforeEach(() => {
    vi.useFakeTimers();
    started.length = 0;
    stopped.length = 0;
    restarted.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('derives the summary line and the Tailscale quota from the API data', async () => {
    const { el } = await render(
      [
        server('a', 'Sobrevivência', 'READY'),
        server('b', 'Criativo', 'STOPPED'),
        server('c', 'ATM', 'STARTING'),
        server('d', 'Pixelmon', 'CRASHED'),
      ],
      [{ status: 'ACTIVE' }, { status: 'ACTIVE' }, { status: 'REVOKED' }],
    );

    expect(el.textContent).toContain('4 servidores · 1 online · 3 jogadores conectados');
    expect(el.textContent).toContain('2/50 dispositivos ativos na cota');
    expect(el.querySelector('[aria-label="Tailscale"]')?.getAttribute('aria-valuenow')).toBe('4');
  });

  it('shows the disk banner with the percentage from the disk alerts', async () => {
    const { el } = await render([server('a', 'A', 'READY')]);

    expect(el.querySelector('mc-banner')?.textContent).toContain('Disco em 78 %');
    expect(el.querySelector('mc-banner')?.textContent).toContain('Acima de 75 %');
  });

  it('maps each lifecycle state to its card action (Parar, Ligar, disabled, Reiniciar)', async () => {
    const { el } = await render([
      server('a', 'A', 'READY'),
      server('b', 'B', 'STOPPED'),
      server('c', 'C', 'STARTING'),
      server('d', 'D', 'CRASHED'),
    ]);

    expect(buttons(el)).toEqual([
      'Parar|Abrir',
      'Ligar|Abrir',
      'Iniciando…|Abrir',
      'Reiniciar|Abrir',
    ]);
  });

  it('stops a running server through the real API and reloads the list', async () => {
    const { el } = await render([server('a', 'A', 'READY')]);

    el.querySelector<HTMLButtonElement>('mc-server-card button')!.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(stopped).toEqual(['a']);
  });

  it('restarts a crashed server through the restart endpoint', async () => {
    const { el } = await render([server('d', 'D', 'CRASHED')]);

    el.querySelector<HTMLButtonElement>('mc-server-card button')!.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(restarted).toEqual(['d']);
    expect(stopped).toEqual([]);
    expect(started).toEqual([]);
  });

  it('shows the empty state with a create call to action when there are no servers', async () => {
    const { el } = await render([]);

    expect(el.textContent).toContain('Nenhum mundo ainda');
    expect(el.querySelectorAll('mc-server-card')).toHaveLength(0);
  });
});
