import { DataSource } from 'typeorm';

import { createIntegrationDataSource, describeWithDatabase } from './testing/integration-datasource';

/**
 * Production runs with DB_SYNCHRONIZE=false, so a table exists only if a migration creates it. Backups failed with
 * `relation "server_backups" does not exist` because three entities never got one (#108).
 */
describeWithDatabase('migrações cobrem todas as entidades', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await createIntegrationDataSource('int_schema_drift');
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('cria toda tabela que uma entidade declara', async () => {
    const tables: { table_name: string }[] = await ds.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`,
    );
    const existing = new Set(tables.map((t) => t.table_name));

    const missing = ds.entityMetadatas.map((m) => m.tableName).filter((name) => !existing.has(name));

    expect(missing).toEqual([]);
  });
});
