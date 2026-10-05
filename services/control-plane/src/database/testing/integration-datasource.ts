import 'reflect-metadata';
import { DataSource } from 'typeorm';

import * as entityModule from '../entities';
import { migrations } from '../migrations';

/** Os specs `*.int.spec.ts` só rodam com TEST_DATABASE_URL (veja o README dos testes de integração abaixo). */
export const integrationDatabaseUrl = process.env.TEST_DATABASE_URL;
export const describeWithDatabase = integrationDatabaseUrl ? describe : describe.skip;

/**
 * Extensões são globais ao banco, não ao schema. A migração inicial cria `pgcrypto` e o TypeORM cria `uuid-ossp`
 * ao conectar; feito em paralelo, um por spec, os dois `CREATE EXTENSION IF NOT EXISTS` disputam a mesma linha de
 * `pg_extension` num banco novo. Sem `WITH SCHEMA`, a extensão ainda cairia no schema do spec e sumiria no próximo
 * `DROP SCHEMA ... CASCADE` dele.
 */
const SHARED_EXTENSIONS = ['pgcrypto', 'uuid-ossp'];
const BOOTSTRAP_LOCK_KEY = 0x6d6b3873;

/**
 * Um schema próprio por spec: o Jest roda arquivos em paralelo e eles não podem disputar as mesmas tabelas.
 * Sobe um Postgres com:
 *   docker run --rm -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=verify -p 55432:5432 postgres:16-alpine
 *   TEST_DATABASE_URL=postgres://postgres:pw@localhost:55432/verify npx jest int.spec
 */
export async function createIntegrationDataSource(schema: string): Promise<DataSource> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require('pg');
  const bootstrap = new Client({ connectionString: integrationDatabaseUrl });
  await bootstrap.connect();
  try {
    await bootstrap.query('SELECT pg_advisory_lock($1)', [BOOTSTRAP_LOCK_KEY]);
    for (const extension of SHARED_EXTENSIONS) {
      await bootstrap.query(`CREATE EXTENSION IF NOT EXISTS "${extension}" WITH SCHEMA public`);
      await bootstrap.query(`ALTER EXTENSION "${extension}" SET SCHEMA public`);
    }
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await bootstrap.end();
  }

  const entities = Object.values(entityModule).filter((value) => typeof value === 'function') as any[];
  const dataSource = new DataSource({
    type: 'postgres',
    url: integrationDatabaseUrl,
    entities,
    migrations,
    extra: { options: `-c search_path=${schema}` },
  });
  await dataSource.initialize();
  await dataSource.runMigrations();
  return dataSource;
}
