import 'reflect-metadata';
import { DataSource } from 'typeorm';

import * as entityModule from '../entities';
import { migrations } from '../migrations';

/** Os specs `*.int.spec.ts` só rodam com TEST_DATABASE_URL (veja o README dos testes de integração abaixo). */
export const integrationDatabaseUrl = process.env.TEST_DATABASE_URL;
export const describeWithDatabase = integrationDatabaseUrl ? describe : describe.skip;

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
  await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await bootstrap.query(`CREATE SCHEMA "${schema}"`);
  await bootstrap.end();

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
