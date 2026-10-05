import 'reflect-metadata';
import { DataSource } from 'typeorm';

import { migrations } from './migrations';
import { runMigrationsExclusively } from './run-migrations';
import {
  describeWithDatabase,
  integrationDatabaseUrl,
  integrationEntities,
  prepareIntegrationSchema,
} from './testing/integration-datasource';

const SCHEMA = 'it_run_migrations';

describeWithDatabase('runMigrationsExclusively (Postgres real)', () => {
  const dataSources: DataSource[] = [];

  // Pool de uma conexão: se a trava e as migrações usassem conexões diferentes, isto travaria.
  const connectControlPlane = () => {
    const dataSource = new DataSource({
      type: 'postgres',
      url: integrationDatabaseUrl,
      entities: integrationEntities,
      migrations,
      extra: { max: 1, options: `-c search_path=${SCHEMA}` },
    });
    dataSources.push(dataSource);
    return dataSource.initialize();
  };

  beforeEach(() => prepareIntegrationSchema(SCHEMA));

  afterEach(async () => {
    await Promise.all(dataSources.splice(0).map((dataSource) => dataSource.destroy()));
  });

  it('dois control planes subindo juntos aplicam cada migração uma única vez', async () => {
    const [first, second] = await Promise.all([connectControlPlane(), connectControlPlane()]);

    const [ranByFirst, ranBySecond] = await Promise.all([
      runMigrationsExclusively(first),
      runMigrationsExclusively(second),
    ]);

    expect(ranByFirst.length + ranBySecond.length).toBe(migrations.length);
    const applied = await first.query(`SELECT name FROM "${SCHEMA}"."migrations"`);
    expect(applied).toHaveLength(migrations.length);
  });

  it('um boot com o schema em dia não aplica nada', async () => {
    const dataSource = await connectControlPlane();
    await runMigrationsExclusively(dataSource);

    expect(await runMigrationsExclusively(dataSource)).toEqual([]);
  });

  // A trava é reentrante na mesma sessão, então quem migra depois precisa ser outro control plane:
  // se a conexão do primeiro voltasse ao pool ainda com a trava, o segundo esperaria para sempre.
  it('solta a trava quando uma migração falha, e outro control plane consegue migrar', async () => {
    const failing = await connectControlPlane();
    await failing.query(`CREATE TABLE "${SCHEMA}"."servers" (id int)`);
    await expect(runMigrationsExclusively(failing)).rejects.toThrow();
    await failing.query(`DROP TABLE "${SCHEMA}"."servers"`);

    const next = await connectControlPlane();
    expect(await runMigrationsExclusively(next)).toHaveLength(migrations.length);
  });
});
