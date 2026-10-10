import { DataSource, QueryFailedError } from 'typeorm';

import { Server } from './entities';
import {
  createIntegrationDataSource,
  describeWithDatabase,
} from './testing/integration-datasource';

/**
 * Deployment, Service and PVC of every server already running are named after its subdomain at the time they were
 * created; the migration has to keep those names valid by making them the resource_name.
 */
describeWithDatabase('servers.resource_name contra Postgres real', () => {
  let ds: DataSource;

  const insertLegacyServer = (subdomain: string) =>
    ds.query(
      `INSERT INTO "servers" ("name", "subdomain", "server_type", "game_version")
       VALUES ($1, $2, 'PAPER', '1.20.4')`,
      [subdomain, subdomain],
    );

  const resourceNames = async () =>
    (await ds.query(`SELECT "subdomain", "resource_name" FROM "servers" ORDER BY "subdomain"`)) as {
      subdomain: string;
      resource_name: string;
    }[];

  beforeAll(async () => {
    ds = await createIntegrationDataSource('int_server_resource_name');
  });

  beforeEach(async () => {
    await ds.getRepository(Server).createQueryBuilder().delete().execute();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('recusa dois servidores com o mesmo resource_name', async () => {
    const servers = ds.getRepository(Server);
    const base = { server_type: 'PAPER', game_version: '1.20.4' };
    await servers.save(servers.create({ ...base, name: 'A', subdomain: 'a', resource_name: 'x' }));

    await expect(
      servers.save(servers.create({ ...base, name: 'B', subdomain: 'b', resource_name: 'x' })),
    ).rejects.toThrow(QueryFailedError);
  });

  it('a migração preenche resource_name com o subdomínio atual dos servidores existentes', async () => {
    // Undoes the newer migrations as well, so the test does not depend on this one being the last.
    const applied = () =>
      ds.query(`SELECT 1 FROM "migrations" WHERE "name" = 'AddServerResourceName1710000000008'`);
    while ((await applied()).length > 0) {
      await ds.undoLastMigration();
    }
    await insertLegacyServer('mundo-teste');
    await insertLegacyServer('survival');

    await ds.runMigrations();
    expect(await resourceNames()).toEqual([
      { subdomain: 'mundo-teste', resource_name: 'mundo-teste' },
      { subdomain: 'survival', resource_name: 'survival' },
    ]);
  });

  it('rodar a migração de novo não altera o resource_name de um servidor cujo subdomínio mudou', async () => {
    const servers = ds.getRepository(Server);
    await servers.save(
      servers.create({
        name: 'Mundo',
        subdomain: 'mundo-novo',
        resource_name: 'mundo',
        server_type: 'PAPER',
        game_version: '1.20.4',
      }),
    );

    const migration = ds.migrations.find((m) => m.name === 'AddServerResourceName1710000000008');
    const runner = ds.createQueryRunner();
    try {
      await migration?.up(runner);
    } finally {
      await runner.release();
    }

    expect(await resourceNames()).toEqual([{ subdomain: 'mundo-novo', resource_name: 'mundo' }]);
  });
});
