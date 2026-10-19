import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServerBackupSchedule1710000000013 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "backup_schedule_mode" varchar(20) NOT NULL DEFAULT 'OFF';
      ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "backup_interval_hours" integer;
      ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "backup_daily_time" varchar(5);
      ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "backup_window_start" varchar(5);
      ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "backup_window_end" varchar(5);
      ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "backup_timezone" varchar(50) NOT NULL DEFAULT 'America/Sao_Paulo';
      ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "backup_retention_count" integer NOT NULL DEFAULT 5;
      ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "backup_next_run_at" timestamptz;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers" DROP COLUMN IF EXISTS "backup_schedule_mode";
      ALTER TABLE "servers" DROP COLUMN IF EXISTS "backup_interval_hours";
      ALTER TABLE "servers" DROP COLUMN IF EXISTS "backup_daily_time";
      ALTER TABLE "servers" DROP COLUMN IF EXISTS "backup_window_start";
      ALTER TABLE "servers" DROP COLUMN IF EXISTS "backup_window_end";
      ALTER TABLE "servers" DROP COLUMN IF EXISTS "backup_timezone";
      ALTER TABLE "servers" DROP COLUMN IF EXISTS "backup_retention_count";
      ALTER TABLE "servers" DROP COLUMN IF EXISTS "backup_next_run_at";
    `);
  }
}
