import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServerStopWarningMinutes1710000000012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "stop_warning_minutes" integer NOT NULL DEFAULT 10;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers" DROP COLUMN IF EXISTS "stop_warning_minutes";
    `);
  }
}
