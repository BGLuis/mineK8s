import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { User } from './entities';
import { createIntegrationDataSource, describeWithDatabase } from './testing/integration-datasource';

/** Login e gateway acham o usuário por tailscale_user_id; só o índice do banco impede dois donos do mesmo ID (#135). */
describeWithDatabase('users.tailscale_user_id único contra Postgres real', () => {
  let ds: DataSource;
  let users: Repository<User>;

  beforeAll(async () => {
    ds = await createIntegrationDataSource('int_user_tailscale_id');
    users = ds.getRepository(User);
  });

  beforeEach(async () => {
    await users.createQueryBuilder().delete().execute();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('recusa um segundo usuário com o mesmo tailscale_user_id', async () => {
    await users.save(users.create({ minecraft_nick: 'Steve', tailscale_user_id: '1001' }));

    await expect(users.save(users.create({ minecraft_nick: 'Alex', tailscale_user_id: '1001' }))).rejects.toThrow(
      QueryFailedError,
    );
    expect(await users.countBy({ tailscale_user_id: '1001' })).toBe(1);
  });

  it('aceita vários usuários sem tailscale_user_id', async () => {
    await users.save([
      users.create({ minecraft_nick: 'Steve', tailscale_user_id: null }),
      users.create({ minecraft_nick: 'Alex', tailscale_user_id: null }),
    ]);

    expect(await users.count()).toBe(2);
  });

  it('a migração aborta listando os duplicados, sem tocar neles, e passa depois de resolvidos', async () => {
    await ds.undoLastMigration();
    await users.save([
      users.create({ minecraft_nick: 'Steve', tailscale_user_id: '1001' }),
      users.create({ minecraft_nick: 'Alex', tailscale_user_id: '1001' }),
      users.create({ minecraft_nick: 'Notch', tailscale_user_id: '2002' }),
      users.create({ minecraft_nick: 'Herobrine', tailscale_user_id: '2002' }),
      users.create({ minecraft_nick: 'Jeb', tailscale_user_id: '3003' }),
    ]);

    await expect(ds.runMigrations()).rejects.toThrow('  1001: Alex, Steve\n  2002: Herobrine, Notch');
    expect(await users.countBy({ tailscale_user_id: '1001' })).toBe(2);

    await users.update({ minecraft_nick: 'Alex' }, { tailscale_user_id: null });
    await users.update({ minecraft_nick: 'Herobrine' }, { tailscale_user_id: null });
    await ds.runMigrations();

    await expect(users.update({ minecraft_nick: 'Alex' }, { tailscale_user_id: '1001' })).rejects.toThrow(
      QueryFailedError,
    );
  });
});
