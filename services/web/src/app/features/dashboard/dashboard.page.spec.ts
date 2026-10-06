import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, of } from 'rxjs';

import { NodeMetrics, ServerState, ServerSummary } from '../../core/api/models';
import { NodeApi } from '../../core/api/node.api';
import { ServersApi } from '../../core/api/servers.api';
import { ServersSocket } from '../../core/realtime/servers-socket';
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
  access_policy: 'GROUP',
  is_maintenance: false,
  auto_wake: true,
  sleep_timeout_minutes: 15,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

const GIB = 1024 ** 3;

const nodeMetrics = (overrides: Partial<NodeMetrics> = {}): NodeMetrics => ({
  cpu: { usedPercent: 42, cores: 8 },
  memory: { total: 32 * GIB, allocated: 8 * GIB },
  disk: { total: 500 * GIB, free: 185 * GIB, usedPercent: 63, alert: null, blocksCreation: false },
  tailnet: { active: 2, limit: 50 },
  ...overrides,
});

describe('DashboardPage', () => {
  const started: string[] = [];
  const stopped: string[] = [];
  const restarted: string[] = [];

  async function render(servers: ServerSummary[], metrics: NodeMetrics = nodeMetrics()) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ServersApi,
          useValue: {
            list: () => of(servers),
            players: () => of({ online: 3, max: 20, players: [] }),
            start: (id: string) => (started.push(id), of({ message: 'ok' })),
            stop: (id: string) => (stopped.push(id), of({ message: 'ok' })),
            restart: (id: string) => (restarted.push(id), of({ message: 'ok' })),
          },
        },
        { provide: ServersSocket, useValue: { signals: () => NEVER } },
        { provide: NodeApi, useValue: { metrics: () => of(metrics) } },
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

  it('derives the summary line from the servers and the quota from the node metrics', async () => {
    const { el } = await render([
      server('a', 'Sobrevivência', 'READY'),
      server('b', 'Criativo', 'STOPPED'),
      server('c', 'ATM', 'STARTING'),
      server('d', 'Pixelmon', 'CRASHED'),
    ]);

    expect(el.textContent).toContain('4 servidores · 1 online · 3 jogadores conectados');
    expect(el.textContent).toContain('2/50 dispositivos ativos na cota');
    expect(el.querySelector('[aria-label="Tailscale"]')?.getAttribute('aria-valuenow')).toBe('4');
  });

  it('shows CPU, RAM and NVMe from the API with no "sem API" tag', async () => {
    const { el } = await render([server('a', 'A', 'READY')]);

    expect(el.querySelector('[aria-label="CPU"]')?.getAttribute('aria-valuenow')).toBe('42');
    expect(el.querySelector('[aria-label="RAM"]')?.getAttribute('aria-valuenow')).toBe('25');
    expect(el.querySelector('[aria-label="NVMe"]')?.getAttribute('aria-valuenow')).toBe('63');
    expect(el.querySelector('mc-no-api-tag')).toBeNull();
  });

  it('shows no disk banner while the disk is below the warning threshold', async () => {
    const { el } = await render([server('a', 'A', 'READY')]);

    expect(el.querySelector('mc-banner')).toBeNull();
  });

  it('shows the warning banner with the percentage the API reported', async () => {
    const disk = { total: 500 * GIB, free: 110 * GIB, usedPercent: 78, alert: 'warning' as const };
    const { el } = await render(
      [server('a', 'A', 'READY')],
      nodeMetrics({ disk: { ...disk, blocksCreation: false } }),
    );

    const banner = el.querySelector('mc-banner')?.textContent;
    expect(banner).toContain('Disco em 78 %');
    expect(banner).toContain('Acima de 75 %');
    expect(banner).not.toContain('bloqueada');
  });

  it('says that creating servers is blocked once the API reports it', async () => {
    const { el } = await render(
      [server('a', 'A', 'READY')],
      nodeMetrics({
        disk: {
          total: 500 * GIB,
          free: 50 * GIB,
          usedPercent: 90,
          alert: 'danger',
          blocksCreation: true,
        },
      }),
    );

    const banner = el.querySelector('mc-banner')?.textContent;
    expect(banner).toContain('Acima de 90 %');
    expect(banner).toContain('criação de servidores está bloqueada');
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
