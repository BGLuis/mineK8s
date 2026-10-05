import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Login e gateway acham o usuário por `tailscale_user_id`; dois donos do mesmo ID entram como qualquer um deles.
 * Duplicados já gravados não são resolvidos aqui: escolher quem fica com o ID é decisão de quem administra.
 */
export class UniqueUserTailscaleId1710000000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicates: { tailscale_user_id: string; nicks: string }[] = await queryRunner.query(`
      SELECT "tailscale_user_id", string_agg("minecraft_nick", ', ' ORDER BY "minecraft_nick") AS "nicks"
      FROM "users"
      WHERE "tailscale_user_id" IS NOT NULL
      GROUP BY "tailscale_user_id"
      HAVING COUNT(*) > 1
      ORDER BY "tailscale_user_id";
    `);
    if (duplicates.length > 0) {
      const conflicts = duplicates.map((d) => `  ${d.tailscale_user_id}: ${d.nicks}`).join('\n');
      throw new Error(
        `users.tailscale_user_id has duplicates, so the unique index cannot be created. ` +
          `Keep the ID on one user per line and set the others to NULL, then run the migrations again:\n${conflicts}`,
      );
    }

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_users_tailscale_user_id" ON "users" ("tailscale_user_id")
      WHERE "tailscale_user_id" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_users_tailscale_user_id";`);
  }
}
