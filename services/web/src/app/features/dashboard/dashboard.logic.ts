import { ServerSummary, TailscaleDevice } from '../../core/api/models';
import { ServerPlayerCount } from '../../ui';

/** Free Tailscale plan limit shown in the sidebar and on the dashboard (SRS tailnet quota). */
export const TAILSCALE_DEVICE_LIMIT = 50;

export interface DashboardSummary {
  total: number;
  online: number;
  players: number;
}

export interface TailscaleQuota {
  used: number;
  limit: number;
  percent: number;
}

/** "Online" means READY; only those servers contribute players. */
export function summarizeServers(
  servers: readonly Pick<ServerSummary, 'id' | 'state'>[],
  playersById: Readonly<Record<string, ServerPlayerCount>>,
): DashboardSummary {
  const online = servers.filter((server) => server.state === 'READY');
  return {
    total: servers.length,
    online: online.length,
    players: online.reduce((sum, server) => sum + (playersById[server.id]?.online ?? 0), 0),
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function summaryText(summary: DashboardSummary): string {
  return [
    plural(summary.total, 'servidor', 'servidores'),
    `${summary.online} online`,
    plural(summary.players, 'jogador conectado', 'jogadores conectados'),
  ].join(' · ');
}

/** Short form for narrow screens, as in the mobile frame. */
export function compactSummaryText(summary: DashboardSummary): string {
  return [`${summary.online} online`, plural(summary.players, 'jogador', 'jogadores')].join(' · ');
}

/** Only ACTIVE devices count against the quota; PENDING and REVOKED ones do not. */
export function tailscaleQuota(
  devices: readonly Pick<TailscaleDevice, 'status'>[],
  limit: number = TAILSCALE_DEVICE_LIMIT,
): TailscaleQuota {
  const used = devices.filter((device) => device.status === 'ACTIVE').length;
  return { used, limit, percent: Math.round((used / limit) * 100) };
}
