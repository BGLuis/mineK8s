import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLastPlayerActiveAt1710000000002 implements MigrationInterface {
  name = 'AddLastPlayerActiveAt1710000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers"
      ADD COLUMN IF NOT EXISTS "last_player_active_at" TIMESTAMPTZ;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers"
      DROP COLUMN IF EXISTS "last_player_active_at";
    `);
  }
}
