import { AccessDecisionEngineService } from './access-decision-engine.service';
import { AccessResolverService } from './access-resolver.service';

describe('AccessResolverService (#211)', () => {
  let resolver: AccessResolverService;
  let mockUserRepo: any;
  let mockServerRepo: any;
  let mockServerGroupRepo: any;
  let mockUserGroupRepo: any;
  let mockUserServerAccessRepo: any;
  let mockGroupRepo: any;

  beforeEach(() => {
    mockUserRepo = {
      find: jest.fn(async () => []),
    };
    mockServerRepo = {
      find: jest.fn(async () => []),
    };
    mockServerGroupRepo = {
      find: jest.fn(async () => []),
    };
    mockUserGroupRepo = {
      find: jest.fn(async () => []),
    };
    mockUserServerAccessRepo = {
      find: jest.fn(async () => []),
    };
    mockGroupRepo = {
      find: jest.fn(async () => []),
    };

    resolver = new AccessResolverService(
      mockUserRepo,
      mockServerRepo,
      mockServerGroupRepo,
      mockUserGroupRepo,
      mockUserServerAccessRepo,
      mockGroupRepo,
      new AccessDecisionEngineService(),
    );
  });

  describe('Parity with crates/gateway/src/identity/acl_engine.rs', () => {
    const adminUser = { id: 'u-admin', role: 'ADMIN' as const, minecraft_nick: 'Admin' };
    const playerUser = { id: 'u-player', role: 'PLAYER' as const, minecraft_nick: 'Player' };
    const inactivePlayer = {
      id: 'u-inactive',
      role: 'PLAYER' as const,
      minecraft_nick: 'Inactive',
      isActive: false,
    };

    it('admin in maintenance is allowed with ADMIN bypass', async () => {
      const server = {
        id: 's-maint',
        name: 'Maint',
        subdomain: 'maint',
        state: 'READY' as const,
        access_policy: 'PUBLIC' as const,
        is_maintenance: true,
      };

      const [res] = await resolver.explain(['u-admin'], {
        users: [adminUser as any],
        servers: [server as any],
      });

      expect(res.allowed).toBe(true);
      expect(res.grantedBy).toEqual({ kind: 'ADMIN' });
    });

    it('PUBLIC policy allows PLAYER with POLICY grant', async () => {
      const server = {
        id: 's-pub',
        name: 'Pub',
        subdomain: 'pub',
        state: 'READY' as const,
        access_policy: 'PUBLIC' as const,
        is_maintenance: false,
      };

      const [res] = await resolver.explain(['u-player'], {
        users: [playerUser as any],
        servers: [server as any],
      });

      expect(res.allowed).toBe(true);
      expect(res.grantedBy).toEqual({ kind: 'POLICY', policy: 'PUBLIC' });
    });

    it('INTERNET policy allows PLAYER with POLICY grant', async () => {
      const server = {
        id: 's-net',
        name: 'Net',
        subdomain: 'net',
        state: 'READY' as const,
        access_policy: 'INTERNET' as const,
        is_maintenance: false,
      };

      const [res] = await resolver.explain(['u-player'], {
        users: [playerUser as any],
        servers: [server as any],
      });

      expect(res.allowed).toBe(true);
      expect(res.grantedBy).toEqual({ kind: 'POLICY', policy: 'INTERNET' });
    });

    it('GROUP policy allows PLAYER when member of matching group', async () => {
      const server = {
        id: 's-grp',
        name: 'Grp',
        subdomain: 'grp',
        state: 'READY' as const,
        access_policy: 'GROUP' as const,
        is_maintenance: false,
      };

      mockServerGroupRepo.find.mockResolvedValue([
        { server_id: 's-grp', group_id: 'g-vips', group: { id: 'g-vips', name: 'VIPs' } },
      ]);
      mockUserGroupRepo.find.mockResolvedValue([{ user_id: 'u-player', group_id: 'g-vips' }]);

      const [res] = await resolver.explain(['u-player'], {
        users: [playerUser as any],
        servers: [server as any],
      });

      expect(res.allowed).toBe(true);
      expect(res.grantedBy).toEqual({
        kind: 'GROUP',
        groupIds: ['g-vips'],
        groupNames: ['VIPs'],
      });
    });

    it('GROUP policy denies PLAYER without matching group', async () => {
      const server = {
        id: 's-grp',
        name: 'Grp',
        subdomain: 'grp',
        state: 'READY' as const,
        access_policy: 'GROUP' as const,
        is_maintenance: false,
      };

      mockServerGroupRepo.find.mockResolvedValue([
        { server_id: 's-grp', group_id: 'g-vips', group: { id: 'g-vips', name: 'VIPs' } },
      ]);
      mockUserGroupRepo.find.mockResolvedValue([{ user_id: 'u-player', group_id: 'g-other' }]);

      const [res] = await resolver.explain(['u-player'], {
        users: [playerUser as any],
        servers: [server as any],
      });

      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('INSUFFICIENT_GROUPS');
      expect(res.grantedBy).toBeNull();
    });

    it('INDIVIDUAL policy allows PLAYER with direct access grant', async () => {
      const server = {
        id: 's-indiv',
        name: 'Indiv',
        subdomain: 'indiv',
        state: 'READY' as const,
        access_policy: 'INDIVIDUAL' as const,
        is_maintenance: false,
      };

      mockUserServerAccessRepo.find.mockResolvedValue([
        { user_id: 'u-player', server_id: 's-indiv' },
      ]);

      const [res] = await resolver.explain(['u-player'], {
        users: [playerUser as any],
        servers: [server as any],
      });

      expect(res.allowed).toBe(true);
      expect(res.grantedBy).toEqual({ kind: 'DIRECT' });
    });

    it('INDIVIDUAL policy denies PLAYER without direct access grant', async () => {
      const server = {
        id: 's-indiv',
        name: 'Indiv',
        subdomain: 'indiv',
        state: 'READY' as const,
        access_policy: 'INDIVIDUAL' as const,
        is_maintenance: false,
      };

      mockUserServerAccessRepo.find.mockResolvedValue([]);

      const [res] = await resolver.explain(['u-player'], {
        users: [playerUser as any],
        servers: [server as any],
      });

      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('INDIVIDUAL_ACCESS_DENIED');
      expect(res.grantedBy).toBeNull();
    });

    it('inactive user is denied with USER_INACTIVE regardless of world policy', async () => {
      const server = {
        id: 's-pub',
        name: 'Pub',
        subdomain: 'pub',
        state: 'READY' as const,
        access_policy: 'PUBLIC' as const,
        is_maintenance: false,
      };

      const [res] = await resolver.explain(['u-inactive'], {
        users: [inactivePlayer as any],
        servers: [server as any],
      });

      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('USER_INACTIVE');
      expect(res.grantedBy).toBeNull();
    });
  });

  describe('Grant Explanation Details', () => {
    it('grantedBy.groupIds lists ALL groups that grant access to the world, preserving order', async () => {
      const player = { id: 'u-player', role: 'PLAYER' as const };
      const server = {
        id: 's-multi',
        name: 'Multi',
        subdomain: 'multi',
        state: 'READY' as const,
        access_policy: 'GROUP' as const,
        is_maintenance: false,
      };

      mockServerGroupRepo.find.mockResolvedValue([
        { server_id: 's-multi', group_id: 'g-vips', group: { id: 'g-vips', name: 'VIPs' } },
        {
          server_id: 's-multi',
          group_id: 'g-builders',
          group: { id: 'g-builders', name: 'Builders' },
        },
        { server_id: 's-multi', group_id: 'g-staff', group: { id: 'g-staff', name: 'Staff' } },
      ]);

      mockUserGroupRepo.find.mockResolvedValue([
        { user_id: 'u-player', group_id: 'g-vips' },
        { user_id: 'u-player', group_id: 'g-staff' },
      ]);

      const [res] = await resolver.explain(['u-player'], {
        users: [player as any],
        servers: [server as any],
      });

      expect(res.allowed).toBe(true);
      expect(res.grantedBy).toEqual({
        kind: 'GROUP',
        groupIds: ['g-vips', 'g-staff'],
        groupNames: ['VIPs', 'Staff'],
      });
    });

    it('user with direct access only to world A does NOT appear allowed on INDIVIDUAL world B', async () => {
      const player = { id: 'u-player', role: 'PLAYER' as const };
      const worldA = {
        id: 'world-a',
        name: 'World A',
        subdomain: 'a',
        state: 'READY' as const,
        access_policy: 'INDIVIDUAL' as const,
        is_maintenance: false,
      };
      const worldB = {
        id: 'world-b',
        name: 'World B',
        subdomain: 'b',
        state: 'READY' as const,
        access_policy: 'INDIVIDUAL' as const,
        is_maintenance: false,
      };

      mockUserServerAccessRepo.find.mockResolvedValue([
        { user_id: 'u-player', server_id: 'world-a' },
      ]);

      const explanations = await resolver.explain(['u-player'], {
        users: [player as any],
        servers: [worldA as any, worldB as any],
      });

      const resA = explanations.find((e) => e.serverId === 'world-a');
      const resB = explanations.find((e) => e.serverId === 'world-b');

      expect(resA?.allowed).toBe(true);
      expect(resA?.grantedBy).toEqual({ kind: 'DIRECT' });

      expect(resB?.allowed).toBe(false);
      expect(resB?.reason).toBe('INDIVIDUAL_ACCESS_DENIED');
      expect(resB?.grantedBy).toBeNull();
    });
  });

  describe('Hypothetical state diffs', () => {
    const player = { id: 'u-player', role: 'PLAYER' as const };
    const groupServer = {
      id: 's-group',
      name: 'GroupWorld',
      subdomain: 'gw',
      state: 'READY' as const,
      access_policy: 'GROUP' as const,
      is_maintenance: false,
    };
    const indivServer = {
      id: 's-indiv',
      name: 'IndivWorld',
      subdomain: 'iw',
      state: 'READY' as const,
      access_policy: 'INDIVIDUAL' as const,
      is_maintenance: false,
    };

    it('addUserToGroup grants hypothetical access', async () => {
      mockServerGroupRepo.find.mockResolvedValue([{ server_id: 's-group', group_id: 'g-vips' }]);
      mockUserGroupRepo.find.mockResolvedValue([]);

      const [res] = await resolver.explain(['u-player'], {
        users: [player as any],
        servers: [groupServer as any],
        hypothetical: {
          addUserToGroup: [{ userId: 'u-player', groupId: 'g-vips' }],
        },
      });

      expect(res.allowed).toBe(true);
      expect(res.grantedBy).toEqual({ kind: 'GROUP', groupIds: ['g-vips'] });
    });

    it('removeUserFromGroup revokes hypothetical access', async () => {
      mockServerGroupRepo.find.mockResolvedValue([{ server_id: 's-group', group_id: 'g-vips' }]);
      mockUserGroupRepo.find.mockResolvedValue([{ user_id: 'u-player', group_id: 'g-vips' }]);

      const [res] = await resolver.explain(['u-player'], {
        users: [player as any],
        servers: [groupServer as any],
        hypothetical: {
          removeUserFromGroup: [{ userId: 'u-player', groupId: 'g-vips' }],
        },
      });

      expect(res.allowed).toBe(false);
      expect(res.grantedBy).toBeNull();
    });

    it('addServerToGroup and removeServerFromGroup work hypothetically', async () => {
      mockUserGroupRepo.find.mockResolvedValue([{ user_id: 'u-player', group_id: 'g-vips' }]);
      mockServerGroupRepo.find.mockResolvedValue([]);

      const [resAdded] = await resolver.explain(['u-player'], {
        users: [player as any],
        servers: [groupServer as any],
        hypothetical: {
          addServerToGroup: [{ serverId: 's-group', groupId: 'g-vips' }],
        },
      });
      expect(resAdded.allowed).toBe(true);

      mockServerGroupRepo.find.mockResolvedValue([{ server_id: 's-group', group_id: 'g-vips' }]);
      const [resRemoved] = await resolver.explain(['u-player'], {
        users: [player as any],
        servers: [groupServer as any],
        hypothetical: {
          removeServerFromGroup: [{ serverId: 's-group', groupId: 'g-vips' }],
        },
      });
      expect(resRemoved.allowed).toBe(false);
    });

    it('grantServer and revokeServer work hypothetically on INDIVIDUAL worlds', async () => {
      mockUserServerAccessRepo.find.mockResolvedValue([]);

      const [resGranted] = await resolver.explain(['u-player'], {
        users: [player as any],
        servers: [indivServer as any],
        hypothetical: {
          grantServer: [{ userId: 'u-player', serverId: 's-indiv' }],
        },
      });
      expect(resGranted.allowed).toBe(true);
      expect(resGranted.grantedBy).toEqual({ kind: 'DIRECT' });

      mockUserServerAccessRepo.find.mockResolvedValue([
        { user_id: 'u-player', server_id: 's-indiv' },
      ]);
      const [resRevoked] = await resolver.explain(['u-player'], {
        users: [player as any],
        servers: [indivServer as any],
        hypothetical: {
          revokeServer: [{ userId: 'u-player', serverId: 's-indiv' }],
        },
      });
      expect(resRevoked.allowed).toBe(false);
      expect(resRevoked.grantedBy).toBeNull();
    });

    it('deleteGroupIds removes access for all users/servers in that group', async () => {
      mockServerGroupRepo.find.mockResolvedValue([{ server_id: 's-group', group_id: 'g-deleted' }]);
      mockUserGroupRepo.find.mockResolvedValue([{ user_id: 'u-player', group_id: 'g-deleted' }]);

      const [res] = await resolver.explain(['u-player'], {
        users: [player as any],
        servers: [groupServer as any],
        hypothetical: {
          deleteGroupIds: ['g-deleted'],
        },
      });

      expect(res.allowed).toBe(false);
      expect(res.grantedBy).toBeNull();
    });
  });

  describe('Query Count Constraint', () => {
    it('executes at most 5 repository queries in batch without opts.users/servers', async () => {
      mockUserRepo.find.mockResolvedValue([{ id: 'u1', role: 'PLAYER' }]);
      mockServerRepo.find.mockResolvedValue([{ id: 's1', access_policy: 'PUBLIC' }]);
      mockServerGroupRepo.find.mockResolvedValue([]);
      mockUserGroupRepo.find.mockResolvedValue([]);
      mockUserServerAccessRepo.find.mockResolvedValue([]);

      await resolver.explain(['u1']);

      expect(mockUserRepo.find).toHaveBeenCalledTimes(1);
      expect(mockServerRepo.find).toHaveBeenCalledTimes(1);
      expect(mockServerGroupRepo.find).toHaveBeenCalledTimes(1);
      expect(mockUserGroupRepo.find).toHaveBeenCalledTimes(1);
      expect(mockUserServerAccessRepo.find).toHaveBeenCalledTimes(1);
    });

    it('executes at most 3 queries when opts.users and opts.servers are supplied', async () => {
      mockServerGroupRepo.find.mockResolvedValue([]);
      mockUserGroupRepo.find.mockResolvedValue([]);
      mockUserServerAccessRepo.find.mockResolvedValue([]);

      await resolver.explain(['u1'], {
        users: [{ id: 'u1', role: 'PLAYER' } as any],
        servers: [{ id: 's1', access_policy: 'PUBLIC' } as any],
      });

      expect(mockUserRepo.find).not.toHaveBeenCalled();
      expect(mockServerRepo.find).not.toHaveBeenCalled();
      expect(mockServerGroupRepo.find).toHaveBeenCalledTimes(1);
      expect(mockUserGroupRepo.find).toHaveBeenCalledTimes(1);
      expect(mockUserServerAccessRepo.find).toHaveBeenCalledTimes(1);
    });
  });
});
