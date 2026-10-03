import { Group, ServerSummary } from '../../core/api/models';

export interface KickCandidates {
  servers: ServerSummary[];
  /** False when no group links the user to a server, so every server is offered instead. */
  viaGroups: boolean;
}

/**
 * There is no endpoint for "servers this user can join". The closest real data is group
 * membership (user_groups x server_groups); individual grants are not exposed to the UI.
 */
export function kickCandidates(
  userId: string,
  groups: readonly Group[],
  servers: readonly ServerSummary[],
): KickCandidates {
  const reachable = new Set(
    groups
      .filter((group) => group.user_groups.some((link) => link.user_id === userId))
      .flatMap((group) => group.server_groups.map((link) => link.server_id)),
  );
  const viaGroups = servers.filter((server) => reachable.has(server.id));
  return viaGroups.length > 0
    ? { servers: viaGroups, viaGroups: true }
    : { servers: [...servers], viaGroups: false };
}

/** A player can only be connected to a running server. */
export function isKickable(server: ServerSummary): boolean {
  return server.state === 'READY';
}
