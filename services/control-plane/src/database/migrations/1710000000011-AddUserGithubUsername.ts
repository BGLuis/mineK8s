import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserGithubUsername1710000000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "github_username" varchar(100);
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_github_username" ON "users" ("github_username")
      WHERE "github_username" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_users_github_username";
      ALTER TABLE "users" DROP COLUMN IF EXISTS "github_username";
    `);
  }
}
