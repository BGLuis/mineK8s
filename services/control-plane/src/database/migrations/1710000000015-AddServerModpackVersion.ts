import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServerModpackVersion1710000000015 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "modpack_version_id" varchar(128);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers" DROP COLUMN IF EXISTS "modpack_version_id";
    `);
  }
}
