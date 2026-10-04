import { User } from '@database/entities/user.entity';

import { AdminLinkError, AdminLinkService } from './admin-link.service';

describe('AdminLinkService (#131)', () => {
  let users: User[];
  let update: jest.Mock;
  let queryWhoIs: jest.Mock;
  let service: AdminLinkService;

  const legacyAdmin = () =>
    ({ id: 'u-legacy', minecraft_nick: 'LegacyAdmin', role: 'ADMIN', tailscale_user_id: null }) as User;
  const linkedPlayer = () =>
    ({ id: 'u-alex', minecraft_nick: 'Alex', role: 'PLAYER', tailscale_user_id: '777' }) as User;

  const snapshot = () => JSON.stringify(users);

  beforeEach(() => {
    users = [legacyAdmin(), linkedPlayer()];
    update = jest.fn(async ({ id }: { id: string }, patch: Partial<User>) => {
      Object.assign(users.find((u) => u.id === id) as User, patch);
    });
    queryWhoIs = jest.fn();
    const matches = (where: Record<string, unknown>) => (u: User) =>
      Object.entries(where).every(([key, value]) => (u as any)[key] === value);
    const repository = {
      findOne: async ({ where }: any) => users.find(matches(where)) ?? null,
      find: async ({ where }: any) => users.filter(matches(where)),
      update,
    };
    service = new AdminLinkService(repository as any, { queryWhoIs } as any);
  });

  async function expectRefused(promise: Promise<unknown>, message: RegExp) {
    const before = snapshot();
    await expect(promise).rejects.toThrow(AdminLinkError);
    await expect(promise).rejects.toThrow(message);
    expect(update).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  }

  describe('linking by Tailscale user ID', () => {
    it('stores the ID on a user that has none', async () => {
      const result = await service.link({ nick: 'LegacyAdmin', tailscaleUserId: '4242' });

      expect(result).toMatchObject({ outcome: 'linked', tailscaleUserId: '4242', previousTailscaleUserId: null });
      expect(users[0].tailscale_user_id).toBe('4242');
      expect(queryWhoIs).not.toHaveBeenCalled();
    });

    it('treats repeating the same pair as success without writing', async () => {
      const result = await service.link({ nick: 'Alex', tailscaleUserId: '777' });

      expect(result.outcome).toBe('unchanged');
      expect(update).not.toHaveBeenCalled();
    });

    it('refuses an unknown nickname', async () => {
      await expectRefused(service.link({ nick: 'Ghost', tailscaleUserId: '4242' }), /No user with Minecraft nickname "Ghost"/);
    });

    it('refuses an ID that belongs to another user, even with --force', async () => {
      await expectRefused(
        service.link({ nick: 'LegacyAdmin', tailscaleUserId: '777', force: true }),
        /already linked to "Alex"/,
      );
    });

    it('refuses to replace a different ID unless forced', async () => {
      await expectRefused(service.link({ nick: 'Alex', tailscaleUserId: '888' }), /pass --force/);
    });

    it('replaces a different ID when forced', async () => {
      const result = await service.link({ nick: 'Alex', tailscaleUserId: '888', force: true });

      expect(result).toMatchObject({ outcome: 'replaced', previousTailscaleUserId: '777' });
      expect(users[1].tailscale_user_id).toBe('888');
    });

    it.each(['alex@example.com', '12ab', '-5', ' 12'])('refuses "%s", which is not a numeric Tailscale user ID', async (value) => {
      await expectRefused(service.link({ nick: 'LegacyAdmin', tailscaleUserId: value }), /not a Tailscale user ID/);
    });
  });

  describe('linking by tailnet IP (WhoIs)', () => {
    const owner = (userId: string) => ({ userId, isOwner: true, tags: [] });

    it('stores the ID that WhoIs reports for the address', async () => {
      queryWhoIs.mockResolvedValue(owner('4242'));

      const result = await service.link({ nick: 'LegacyAdmin', ip: '100.101.102.103' });

      expect(queryWhoIs).toHaveBeenCalledWith('100.101.102.103');
      expect(result).toMatchObject({ outcome: 'linked', tailscaleUserId: '4242' });
      expect(users[0].tailscale_user_id).toBe('4242');
    });

    it('accepts an IPv6 tailnet address', async () => {
      queryWhoIs.mockResolvedValue(owner('4242'));

      await service.link({ nick: 'LegacyAdmin', ip: 'fd7a:115c:a1e0::1' });

      expect(queryWhoIs).toHaveBeenCalledWith('fd7a:115c:a1e0::1');
    });

    it('refuses an address that WhoIs does not know', async () => {
      queryWhoIs.mockResolvedValue(null);
      await expectRefused(service.link({ nick: 'LegacyAdmin', ip: '203.0.113.9' }), /does not belong to the tailnet/);
    });

    it('refuses a WhoIs answer without a user ID', async () => {
      queryWhoIs.mockResolvedValue({ userId: '', isOwner: true, tags: [] });
      await expectRefused(service.link({ nick: 'LegacyAdmin', ip: '100.101.102.103' }), /does not belong to the tailnet/);
    });

    it('explains an unreachable tailscaled instead of crashing', async () => {
      queryWhoIs.mockRejectedValue(new Error('Local Tailscale socket not available'));
      await expectRefused(
        service.link({ nick: 'LegacyAdmin', ip: '100.101.102.103' }),
        /WhoIs failed for 100.101.102.103: Local Tailscale socket not available/,
      );
    });

    it('refuses a tagged device, whose owner is not a person', async () => {
      queryWhoIs.mockResolvedValue({ userId: '999', isOwner: false, tags: ['tag:server'] });
      await expectRefused(service.link({ nick: 'LegacyAdmin', ip: '100.101.102.103' }), /tagged device \(tag:server\)/);
    });

    it('refuses something that is not an IP without calling WhoIs', async () => {
      await expectRefused(service.link({ nick: 'LegacyAdmin', ip: 'not-an-ip' }), /not a valid IP address/);
      expect(queryWhoIs).not.toHaveBeenCalled();
    });

    it('refuses an ID owned by another user', async () => {
      queryWhoIs.mockResolvedValue(owner('777'));
      await expectRefused(service.link({ nick: 'LegacyAdmin', ip: '100.101.102.103' }), /already linked to "Alex"/);
    });
  });

  it.each([
    ['neither', {}],
    ['both', { tailscaleUserId: '4242', ip: '100.101.102.103' }],
  ])('refuses %s of --tailscale-user-id and --ip', async (_label, source) => {
    await expectRefused(service.link({ nick: 'LegacyAdmin', ...source }), /exactly one of/);
  });
});
