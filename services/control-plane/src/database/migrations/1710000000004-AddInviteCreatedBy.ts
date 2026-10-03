import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInviteCreatedBy1710000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "invites"
      ADD COLUMN "created_by" VARCHAR(16);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "invites"
      DROP COLUMN IF EXISTS "created_by";
    `);
  }
}
