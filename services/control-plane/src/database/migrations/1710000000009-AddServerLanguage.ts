import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The language of what the gateway tells the client (server list entry, refusal reasons), and a friendlier
 * MOTD for the worlds that still have the one the control plane generated at creation.
 */
export class AddServerLanguage1710000000009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "minecraft_server_settings"
        ADD COLUMN IF NOT EXISTS "language" VARCHAR(8) NOT NULL DEFAULT 'pt-BR';
    `);
    // Only the exact generated text is replaced; a MOTD the admin wrote is left alone. `\\n` is a
    // backslash followed by n, which the properties writer turns into a line break.
    await queryRunner.query(`
      UPDATE "minecraft_server_settings" AS m
         SET "motd" = '§a§l' || s."name" || '\\n§7Entre e bom jogo!'
        FROM "servers" AS s
       WHERE s."id" = m."server_id"
         AND m."motd" = 'A MineKubernetes Server [' || s."name" || ']';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "minecraft_server_settings" DROP COLUMN IF EXISTS "language";`,
    );
  }
}
