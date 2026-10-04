import { AccessibleServer, ServerSummary } from '../../core/api/models';

export interface KickCandidates {
  servers: ServerSummary[];
  /** False when the user's accessible servers could not be loaded, so every server is offered instead. */
  exact: boolean;
}

/**
 * `accessible` comes from GET /api/admin/users/:id/servers; the list view supplies the live
 * state, which the kick dialog needs to tell running servers from stopped ones.
 */
export function kickCandidates(
  accessible: readonly AccessibleServer[] | null,
  servers: readonly ServerSummary[],
): KickCandidates {
  if (accessible === null) {
    return { servers: [...servers], exact: false };
  }
  const ids = new Set(accessible.map((server) => server.id));
  return { servers: servers.filter((server) => ids.has(server.id)), exact: true };
}

/** A player can only be connected to a running server. */
export function isKickable(server: ServerSummary): boolean {
  return server.state === 'READY';
}
