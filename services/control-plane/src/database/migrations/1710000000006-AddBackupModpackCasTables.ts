import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ServerBackupEntity, ModpackTaskEntity and CasObjectEntity never had a migration, so on a migrated database every
 * backup, modpack install and CAS write failed with `relation ... does not exist`. IF NOT EXISTS keeps this safe on
 * databases that once ran with DB_SYNCHRONIZE=true and already have the tables.
 */
export class AddBackupModpackCasTables1710000000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "server_backups" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "server_id" UUID NOT NULL REFERENCES "servers"("id") ON DELETE CASCADE,
        "filename" VARCHAR(255) NOT NULL,
        "storage_path" VARCHAR(500) NOT NULL,
        "size_bytes" BIGINT NOT NULL,
        "sha256_checksum" VARCHAR(64) NOT NULL,
        "backup_type" VARCHAR(32) NOT NULL,
        "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        "is_protected" BOOLEAN NOT NULL DEFAULT FALSE,
        "minecraft_version" VARCHAR(32) NOT NULL DEFAULT 'unknown',
        "modpack_version" VARCHAR(64),
        "failure_reason" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "retention_expires_at" TIMESTAMPTZ
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_server_backups_server_created" ON "server_backups" ("server_id", "created_at");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "modpack_install_tasks" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "server_id" UUID NOT NULL,
        "source" VARCHAR(32) NOT NULL,
        "project_id" VARCHAR(128) NOT NULL,
        "version_id" VARCHAR(128) NOT NULL,
        "status" VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
        "progress_percent" SMALLINT NOT NULL DEFAULT 0,
        "current_step" VARCHAR(255) NOT NULL DEFAULT 'Aguardando escalonamento...',
        "downloaded_files" INT NOT NULL DEFAULT 0,
        "total_files" INT NOT NULL DEFAULT 0,
        "error_message" TEXT,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cas_objects" (
        "sha256" VARCHAR(64) PRIMARY KEY,
        "sha1" VARCHAR(40),
        "file_size" BIGINT NOT NULL,
        "file_name" VARCHAR(255) NOT NULL,
        "content_type" VARCHAR(100) NOT NULL DEFAULT 'application/java-archive',
        "storage_path" VARCHAR(500) NOT NULL,
        "last_accessed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_cas_objects_last_accessed" ON "cas_objects" ("last_accessed_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cas_objects";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "modpack_install_tasks";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "server_backups";`);
  }
}
