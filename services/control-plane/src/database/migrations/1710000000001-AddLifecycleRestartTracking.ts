import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLifecycleRestartTracking1710000000001 implements MigrationInterface {
  name = 'AddLifecycleRestartTracking1710000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers"
      ADD COLUMN IF NOT EXISTS "restart_count" INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "last_restart_at" TIMESTAMPTZ;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers"
      DROP COLUMN IF EXISTS "restart_count",
      DROP COLUMN IF EXISTS "last_restart_at";
    `);
  }
}
