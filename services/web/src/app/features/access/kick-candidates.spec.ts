import { AccessibleServer, ServerSummary } from '../../core/api';
import { isKickable, kickCandidates } from './kick-candidates';

const server = (id: string, state: ServerSummary['state'] = 'READY'): ServerSummary =>
  ({ id, name: id, state }) as ServerSummary;

const accessible = (id: string): AccessibleServer => ({ id, name: id, subdomain: id, state: 'READY' });

describe('kickCandidates', () => {
  const servers = [server('survival'), server('creative', 'STOPPED'), server('arena')];

  it('offers only the servers the backend says the user can join, with their live state', () => {
    const result = kickCandidates([accessible('creative'), accessible('arena')], servers);

    expect(result.servers.map((s) => s.id)).toEqual(['creative', 'arena']);
    expect(result.servers[0].state).toBe('STOPPED');
    expect(result.exact).toBe(true);
  });

  it('offers nothing, exactly, for a user who can join no server', () => {
    expect(kickCandidates([], servers)).toEqual({ servers: [], exact: true });
  });

  it('falls back to every server, flagged, when the accessible list could not be loaded', () => {
    const result = kickCandidates(null, servers);

    expect(result.servers).toHaveLength(3);
    expect(result.exact).toBe(false);
  });
});

describe('isKickable', () => {
  it('only running servers have someone to kick', () => {
    expect(isKickable(server('a', 'READY'))).toBe(true);
    expect(isKickable(server('a', 'STOPPED'))).toBe(false);
    expect(isKickable(server('a', 'STARTING'))).toBe(false);
  });
});
