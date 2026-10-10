import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Existing servers keep their current subdomain as resource name, so the Deployment, Service and PVC already
 * created (`mc-<subdomain>`, `data-<subdomain>`) stay valid. A server whose subdomain was changed before this
 * migration already has resources under the old name and must be reconciled by hand.
 */
export class AddServerResourceName1710000000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "resource_name" VARCHAR(63);
    `);
    await queryRunner.query(`
      UPDATE "servers" SET "resource_name" = "subdomain" WHERE "resource_name" IS NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE "servers" ALTER COLUMN "resource_name" SET NOT NULL;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_servers_resource_name" ON "servers" ("resource_name");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_servers_resource_name";`);
    await queryRunner.query(`ALTER TABLE "servers" DROP COLUMN IF EXISTS "resource_name";`);
  }
}
