import { NodeMetrics, ServerSummary } from '../../core/api/models';
import { ServerPlayerCount } from '../../ui';

export interface DashboardSummary {
  total: number;
  online: number;
  players: number;
}

export interface ResourceTile {
  percent: number;
  detail: string;
}

export interface NodeTiles {
  cpu: ResourceTile;
  ram: ResourceTile;
  nvme: ResourceTile;
  tailnet: ResourceTile & { used: number; limit: number };
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

const BYTES_PER_GIB = 1024 ** 3;

function gib(bytes: number): string {
  return (bytes / BYTES_PER_GIB).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function percentOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export function nodeTiles(metrics: NodeMetrics): NodeTiles {
  const { cpu, memory, disk, tailnet } = metrics;
  return {
    cpu: { percent: cpu.usedPercent, detail: plural(cpu.cores, 'núcleo', 'núcleos') },
    ram: {
      percent: percentOf(memory.allocated, memory.total),
      detail: `${gib(memory.allocated)} de ${gib(memory.total)} GiB alocados`,
    },
    nvme: {
      percent: Math.round(disk.usedPercent),
      detail: `${gib(disk.total - disk.free)} de ${gib(disk.total)} GiB usados`,
    },
    tailnet: {
      percent: percentOf(tailnet.active, tailnet.limit),
      detail: `${tailnet.active}/${tailnet.limit} dispositivos ativos na cota`,
      used: tailnet.active,
      limit: tailnet.limit,
    },
  };
}
