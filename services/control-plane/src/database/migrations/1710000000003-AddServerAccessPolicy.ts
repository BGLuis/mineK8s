import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServerAccessPolicy1710000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers"
      ADD COLUMN "access_policy" VARCHAR(20) NOT NULL DEFAULT 'GROUP';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers"
      DROP COLUMN IF EXISTS "access_policy";
    `);
  }
}
