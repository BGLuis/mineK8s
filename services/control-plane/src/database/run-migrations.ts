import { DataSource, Migration, MigrationExecutor } from 'typeorm';

/** 'mk8m'. Advisory locks are per database, so it only has to differ from other keys taken here. */
export const MIGRATION_LOCK_KEY = 0x6d6b386d;

/**
 * Applies pending migrations while holding a Postgres advisory lock, so control planes booting at
 * the same time take turns instead of both running the same migration (TypeORM takes no lock).
 * The lock and the migrations share one connection: with two, a pool of size 1 would wait on itself.
 */
export async function runMigrationsExclusively(dataSource: DataSource): Promise<Migration[]> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    await queryRunner.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      const executor = new MigrationExecutor(dataSource, queryRunner);
      executor.transaction = dataSource.options.migrationsTransactionMode ?? 'all';
      return await executor.executePendingMigrations();
    } finally {
      await queryRunner.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await queryRunner.release();
  }
}
