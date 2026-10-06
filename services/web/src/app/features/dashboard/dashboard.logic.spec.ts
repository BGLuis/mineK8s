import { NodeMetrics, ServerState } from '../../core/api/models';
import { compactSummaryText, nodeTiles, summarizeServers, summaryText } from './dashboard.logic';

const server = (id: string, state: ServerState) => ({ id, state });

describe('summarizeServers', () => {
  const servers = [
    server('a', 'READY'),
    server('b', 'STOPPED'),
    server('c', 'STARTING'),
    server('d', 'CRASHED'),
  ];

  it('counts only READY servers as online', () => {
    expect(summarizeServers(servers, {}).online).toBe(1);
    expect(summarizeServers(servers, {}).total).toBe(4);
  });

  it('sums players of online servers only, ignoring stale counts of servers that are down', () => {
    const players = {
      a: { online: 3, max: 20 },
      b: { online: 7, max: 10 },
    };

    expect(summarizeServers(servers, players).players).toBe(3);
  });

  it('is zero for an empty list', () => {
    expect(summarizeServers([], {})).toEqual({ total: 0, online: 0, players: 0 });
  });
});

describe('summary text', () => {
  it('matches the dashboard copy and pluralises', () => {
    expect(summaryText({ total: 4, online: 1, players: 3 })).toBe(
      '4 servidores · 1 online · 3 jogadores conectados',
    );
    expect(summaryText({ total: 1, online: 1, players: 1 })).toBe(
      '1 servidor · 1 online · 1 jogador conectado',
    );
  });

  it('drops the server count on the compact (mobile) form', () => {
    expect(compactSummaryText({ total: 4, online: 1, players: 3 })).toBe('1 online · 3 jogadores');
  });
});

describe('nodeTiles', () => {
  const GIB = 1024 ** 3;
  const metrics: NodeMetrics = {
    cpu: { usedPercent: 42, cores: 8 },
    memory: { total: 32 * GIB, allocated: 8 * GIB },
    disk: {
      total: 500 * GIB,
      free: 185 * GIB,
      usedPercent: 63,
      alert: null,
      blocksCreation: false,
    },
    tailnet: { active: 12, limit: 50 },
  };

  it('shows RAM as the share promised to servers, not what the host is using', () => {
    expect(nodeTiles(metrics).ram).toEqual({ percent: 25, detail: '8 de 32 GiB alocados' });
  });

  it('shows the disk as used space and the CPU as the measured percentage', () => {
    const { cpu, nvme } = nodeTiles(metrics);

    expect(nvme).toEqual({ percent: 63, detail: '315 de 500 GiB usados' });
    expect(cpu).toEqual({ percent: 42, detail: '8 núcleos' });
  });

  it('takes the quota limit from the server instead of assuming the free plan', () => {
    expect(nodeTiles({ ...metrics, tailnet: { active: 12, limit: 100 } }).tailnet).toEqual({
      percent: 12,
      detail: '12/100 dispositivos ativos na cota',
      used: 12,
      limit: 100,
    });
  });

  it('does not divide by zero when the host reports no memory or limit', () => {
    const empty = nodeTiles({
      ...metrics,
      memory: { total: 0, allocated: 0 },
      tailnet: { active: 0, limit: 0 },
    });

    expect(empty.ram.percent).toBe(0);
    expect(empty.tailnet.percent).toBe(0);
  });
});
