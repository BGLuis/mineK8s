import { Group, ServerSummary } from '../../core/api';
import { isKickable, kickCandidates } from './kick-candidates';

const server = (id: string, state: ServerSummary['state'] = 'READY'): ServerSummary =>
  ({ id, name: id, state }) as ServerSummary;

const group = (id: string, users: string[], servers: string[]): Group => ({
  id,
  name: id,
  description: null,
  created_at: '',
  user_groups: users.map((user_id) => ({ user_id, group_id: id })),
  server_groups: servers.map((server_id) => ({ server_id, group_id: id })),
});

describe('kickCandidates', () => {
  const servers = [server('survival'), server('creative'), server('arena')];

  it('offers only the servers reachable through the user\'s groups', () => {
    const groups = [group('amigos', ['steve'], ['survival']), group('outros', ['alex'], ['arena'])];
    const result = kickCandidates('steve', groups, servers);
    expect(result.servers.map((s) => s.id)).toEqual(['survival']);
    expect(result.viaGroups).toBe(true);
  });

  it('falls back to every server, flagged, when no group links the user to one', () => {
    const result = kickCandidates('steve', [group('outros', ['alex'], ['arena'])], servers);
    expect(result.servers).toHaveLength(3);
    expect(result.viaGroups).toBe(false);
  });
});

describe('isKickable', () => {
  it('only running servers have someone to kick', () => {
    expect(isKickable(server('a', 'READY'))).toBe(true);
    expect(isKickable(server('a', 'STOPPED'))).toBe(false);
    expect(isKickable(server('a', 'STARTING'))).toBe(false);
  });
});
