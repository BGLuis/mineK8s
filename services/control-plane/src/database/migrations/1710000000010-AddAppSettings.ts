import { MigrationInterface, QueryRunner } from 'typeorm';

/** Settings edited on the panel; they take precedence over the environment (ConfigMap and Secret). */
export class AddAppSettings1710000000010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "app_settings" (
        "key" VARCHAR(100) PRIMARY KEY,
        "value" TEXT NOT NULL,
        "is_secret" BOOLEAN NOT NULL DEFAULT false,
        "updated_by" VARCHAR(16),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "app_settings";`);
  }
}
