import { UnauthorizedException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { AuthService } from '../auth/auth.service';
import { JwtService } from '../auth/jwt.service';
import { User } from '../database/entities';
import { createIntegrationDataSource, describeWithDatabase } from '../database/testing/integration-datasource';
import { AdminLinkError, AdminLinkService } from './admin-link.service';

/** The command and the panel login against the same real Postgres, so a link written here is what login reads. */
describeWithDatabase('admin:link against a real Postgres (#131)', () => {
  const ADMIN_TS_ID = '4242';
  const ADMIN_ADDRESS = '100.101.102.103';

  let ds: DataSource;
  let users: Repository<User>;
  let link: AdminLinkService;
  let auth: AuthService;

  const tailscaleIdOf = async (nick: string) =>
    (await users.findOneByOrFail({ minecraft_nick: nick })).tailscale_user_id;

  beforeAll(async () => {
    ds = await createIntegrationDataSource('int_admin_link');
    users = ds.getRepository(User);

    const whoIs = async (ip: string) =>
      ip === ADMIN_ADDRESS ? { userId: ADMIN_TS_ID, isOwner: true, tags: [] } : null;
    link = new AdminLinkService(users, { queryWhoIs: whoIs } as any);
    auth = new AuthService(
      users,
      new JwtService({ jwt: { secret: 'int_secret_that_is_at_least_32_characters_long' } } as any),
      {} as any,
      { queryWhoIs: whoIs } as any,
    );
  });

  beforeEach(async () => {
    await users.createQueryBuilder().delete().execute();
    await users.save([
      users.create({ minecraft_nick: 'LegacyAdmin', role: 'ADMIN', tailscale_user_id: null }),
      users.create({ minecraft_nick: 'Alex', role: 'PLAYER', tailscale_user_id: '777' }),
    ]);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('turns a locked-out legacy admin into one the session endpoint accepts', async () => {
    await expect(auth.createSession(ADMIN_ADDRESS)).rejects.toThrow(UnauthorizedException);

    const result = await link.link({ nick: 'LegacyAdmin', ip: ADMIN_ADDRESS });

    expect(result.outcome).toBe('linked');
    expect(await tailscaleIdOf('LegacyAdmin')).toBe(ADMIN_TS_ID);
    const session = await auth.createSession(ADMIN_ADDRESS);
    expect(session.user).toMatchObject({ minecraft_nick: 'LegacyAdmin', role: 'ADMIN' });
    expect(session.access_token).toEqual(expect.any(String));
  });

  it('links by explicit ID and is idempotent when repeated', async () => {
    await link.link({ nick: 'LegacyAdmin', tailscaleUserId: ADMIN_TS_ID });
    const again = await link.link({ nick: 'LegacyAdmin', tailscaleUserId: ADMIN_TS_ID });

    expect(again.outcome).toBe('unchanged');
    expect(await users.countBy({ tailscale_user_id: ADMIN_TS_ID })).toBe(1);
  });

  it('leaves the database untouched when the nickname is unknown', async () => {
    await expect(link.link({ nick: 'Ghost', tailscaleUserId: ADMIN_TS_ID })).rejects.toThrow(AdminLinkError);

    expect(await users.countBy({ tailscale_user_id: ADMIN_TS_ID })).toBe(0);
  });

  it('leaves the database untouched when the ID already belongs to another user', async () => {
    await expect(link.link({ nick: 'LegacyAdmin', tailscaleUserId: '777', force: true })).rejects.toThrow(
      /already linked to "Alex"/,
    );

    expect(await tailscaleIdOf('LegacyAdmin')).toBeNull();
    expect(await tailscaleIdOf('Alex')).toBe('777');
    expect(await users.countBy({ tailscale_user_id: '777' })).toBe(1);
  });

  it('leaves the database untouched when the IP has no WhoIs', async () => {
    await expect(link.link({ nick: 'LegacyAdmin', ip: '203.0.113.9' })).rejects.toThrow(
      /does not belong to the tailnet/,
    );

    expect(await tailscaleIdOf('LegacyAdmin')).toBeNull();
  });

  it('keeps an existing link unless forced, then replaces it', async () => {
    await expect(link.link({ nick: 'Alex', tailscaleUserId: '888' })).rejects.toThrow(/pass --force/);
    expect(await tailscaleIdOf('Alex')).toBe('777');

    await link.link({ nick: 'Alex', tailscaleUserId: '888', force: true });
    expect(await tailscaleIdOf('Alex')).toBe('888');
  });

  it('turns a link written concurrently after its own check into a readable error (#135)', async () => {
    // Another run (or a manual UPDATE) takes the ID between the ownership check and the write.
    jest.spyOn(users, 'find').mockResolvedValueOnce([]);

    await expect(link.link({ nick: 'LegacyAdmin', tailscaleUserId: '777' })).rejects.toThrow(
      new AdminLinkError(
        'Tailscale user ID 777 was linked to another user while this command ran; one Tailscale account maps to one user',
      ),
    );
    expect(await tailscaleIdOf('LegacyAdmin')).toBeNull();
    expect(await tailscaleIdOf('Alex')).toBe('777');
  });
});
