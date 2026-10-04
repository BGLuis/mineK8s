import { ServerState } from '../../core/api/models';
import {
  TAILSCALE_DEVICE_LIMIT,
  compactSummaryText,
  summarizeServers,
  summaryText,
  tailscaleQuota,
} from './dashboard.logic';

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

describe('tailscaleQuota', () => {
  const devices = [
    { status: 'ACTIVE' as const },
    { status: 'ACTIVE' as const },
    { status: 'PENDING' as const },
    { status: 'REVOKED' as const },
    { status: 'ACTIVE' as const },
  ];

  it('counts only ACTIVE devices against the quota', () => {
    expect(tailscaleQuota(devices).used).toBe(3);
  });

  it('uses the 50 device limit and rounds the percentage', () => {
    expect(TAILSCALE_DEVICE_LIMIT).toBe(50);
    expect(tailscaleQuota(devices)).toEqual({ used: 3, limit: 50, percent: 6 });
    expect(tailscaleQuota(Array(12).fill({ status: 'ACTIVE' }))).toMatchObject({
      used: 12,
      percent: 24,
    });
  });
});
