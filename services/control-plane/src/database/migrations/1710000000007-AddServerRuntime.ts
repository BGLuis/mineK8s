import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServerRuntime1710000000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers"
      ADD COLUMN IF NOT EXISTS "java_version" INT,
      ADD COLUMN IF NOT EXISTS "server_jar_url" VARCHAR(500),
      ADD COLUMN IF NOT EXISTS "server_jar_checksum" VARCHAR(80),
      ADD COLUMN IF NOT EXISTS "server_build" VARCHAR(40),
      ADD COLUMN IF NOT EXISTS "server_build_channel" VARCHAR(20);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers"
      DROP COLUMN IF EXISTS "server_build_channel",
      DROP COLUMN IF EXISTS "server_build",
      DROP COLUMN IF EXISTS "server_jar_checksum",
      DROP COLUMN IF EXISTS "server_jar_url",
      DROP COLUMN IF EXISTS "java_version";
    `);
  }
}
