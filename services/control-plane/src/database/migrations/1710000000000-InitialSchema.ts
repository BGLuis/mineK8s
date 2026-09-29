import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1710000000000 implements MigrationInterface {
  name = 'InitialSchema1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // 1. servers table (RF-MG-01 multi-game with game_type default 'minecraft')
    await queryRunner.query(`
      CREATE TABLE "servers" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" VARCHAR(100) NOT NULL,
        "subdomain" VARCHAR(63) NOT NULL UNIQUE,
        "game_type" VARCHAR(30) NOT NULL DEFAULT 'minecraft',
        "routing_model" VARCHAR(30) NOT NULL DEFAULT 'subdomain',
        "allocated_port" INT,
        "server_type" VARCHAR(30) NOT NULL,
        "game_version" VARCHAR(20) NOT NULL,
        "modpack_id" VARCHAR(100),
        "allocated_memory_mb" INT NOT NULL DEFAULT 4096,
        "state" VARCHAR(20) NOT NULL DEFAULT 'STOPPED',
        "is_maintenance" BOOLEAN NOT NULL DEFAULT false,
        "auto_wake" BOOLEAN NOT NULL DEFAULT true,
        "sleep_timeout_minutes" INT NOT NULL DEFAULT 15,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. minecraft_server_settings table (1:1 with servers)
    await queryRunner.query(`
      CREATE TABLE "minecraft_server_settings" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "server_id" UUID NOT NULL UNIQUE,
        "motd" VARCHAR(255) NOT NULL DEFAULT 'A MineKubernetes Server',
        "max_players" INT NOT NULL DEFAULT 20,
        "difficulty" VARCHAR(20) NOT NULL DEFAULT 'normal',
        "gamemode" VARCHAR(20) NOT NULL DEFAULT 'survival',
        "hardcore" BOOLEAN NOT NULL DEFAULT false,
        "pvp" BOOLEAN NOT NULL DEFAULT true,
        "spawn_protection" INT NOT NULL DEFAULT 16,
        "view_distance" INT NOT NULL DEFAULT 10,
        "simulation_distance" INT NOT NULL DEFAULT 10,
        "enable_rcon" BOOLEAN NOT NULL DEFAULT true,
        "rcon_port" INT NOT NULL DEFAULT 25575,
        "rcon_password" VARCHAR(100) NOT NULL,
        "enforce_secure_chat" BOOLEAN NOT NULL DEFAULT false,
        "online_mode" BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "fk_minecraft_settings_server" FOREIGN KEY ("server_id")
          REFERENCES "servers"("id") ON DELETE CASCADE
      );
    `);

    // 3. users table (TS:426-435)
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "real_name" VARCHAR(120),
        "email" VARCHAR(255) UNIQUE,
        "minecraft_nick" VARCHAR(16) NOT NULL UNIQUE,
        "tailscale_user_id" VARCHAR(100),
        "role" VARCHAR(20) NOT NULL DEFAULT 'PLAYER',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX "idx_users_minecraft_nick" ON "users"("minecraft_nick");
    `);

    // 4. tailscale_devices table (TS:438-452)
    await queryRunner.query(`
      CREATE TABLE "tailscale_devices" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "node_id" VARCHAR(100) UNIQUE,
        "node_ip" VARCHAR(45),
        "tailscale_tag" VARCHAR(100) NOT NULL UNIQUE,
        "device_name" VARCHAR(150),
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "last_seen_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "fk_tailscale_devices_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      );
      CREATE INDEX "idx_devices_tailscale_tag" ON "tailscale_devices"("tailscale_tag");
      CREATE INDEX "idx_devices_node_ip" ON "tailscale_devices"("node_ip");
    `);

    // 5. groups table (TS:468-473)
    await queryRunner.query(`
      CREATE TABLE "groups" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" VARCHAR(80) NOT NULL UNIQUE,
        "description" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 6. user_groups associative table (TS:476-480)
    await queryRunner.query(`
      CREATE TABLE "user_groups" (
        "user_id" UUID NOT NULL,
        "group_id" UUID NOT NULL,
        PRIMARY KEY ("user_id", "group_id"),
        CONSTRAINT "fk_user_groups_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_user_groups_group" FOREIGN KEY ("group_id")
          REFERENCES "groups"("id") ON DELETE CASCADE
      );
    `);

    // 7. server_groups associative table (TS:483-487)
    await queryRunner.query(`
      CREATE TABLE "server_groups" (
        "server_id" UUID NOT NULL,
        "group_id" UUID NOT NULL,
        PRIMARY KEY ("server_id", "group_id"),
        CONSTRAINT "fk_server_groups_server" FOREIGN KEY ("server_id")
          REFERENCES "servers"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_server_groups_group" FOREIGN KEY ("group_id")
          REFERENCES "groups"("id") ON DELETE CASCADE
      );
    `);

    // 8. user_server_access associative table (TS:490-495)
    await queryRunner.query(`
      CREATE TABLE "user_server_access" (
        "user_id" UUID NOT NULL,
        "server_id" UUID NOT NULL,
        "granted_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY ("user_id", "server_id"),
        CONSTRAINT "fk_user_server_access_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_user_server_access_server" FOREIGN KEY ("server_id")
          REFERENCES "servers"("id") ON DELETE CASCADE
      );
    `);

    // 9. invites table (TS:454-465)
    await queryRunner.query(`
      CREATE TABLE "invites" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "token" VARCHAR(64) NOT NULL UNIQUE,
        "name" VARCHAR(100) NOT NULL,
        "max_uses" INT NOT NULL DEFAULT 1,
        "used_count" INT NOT NULL DEFAULT 0,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX "idx_invites_token" ON "invites"("token");
    `);

    // 10. invite_groups associative table (TS:498-502)
    await queryRunner.query(`
      CREATE TABLE "invite_groups" (
        "invite_id" UUID NOT NULL,
        "group_id" UUID NOT NULL,
        PRIMARY KEY ("invite_id", "group_id"),
        CONSTRAINT "fk_invite_groups_invite" FOREIGN KEY ("invite_id")
          REFERENCES "invites"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_invite_groups_group" FOREIGN KEY ("group_id")
          REFERENCES "groups"("id") ON DELETE CASCADE
      );
    `);

    // 11. invite_servers associative table (TS:505-509)
    await queryRunner.query(`
      CREATE TABLE "invite_servers" (
        "invite_id" UUID NOT NULL,
        "server_id" UUID NOT NULL,
        PRIMARY KEY ("invite_id", "server_id"),
        CONSTRAINT "fk_invite_servers_invite" FOREIGN KEY ("invite_id")
          REFERENCES "invites"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_invite_servers_server" FOREIGN KEY ("server_id")
          REFERENCES "servers"("id") ON DELETE CASCADE
      );
    `);

    // 12. server_audit_logs table (RCON:459-470, C-16)
    await queryRunner.query(`
      CREATE TABLE "server_audit_logs" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "server_id" UUID NOT NULL,
        "user_id" UUID,
        "command" VARCHAR(500) NOT NULL,
        "execution_source" VARCHAR(30) NOT NULL,
        "ip_address" VARCHAR(45),
        "response" TEXT,
        "executed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "fk_server_audit_logs_server" FOREIGN KEY ("server_id")
          REFERENCES "servers"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_server_audit_logs_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      );
      CREATE INDEX "idx_audit_logs_server_id" ON "server_audit_logs"("server_id");
      CREATE INDEX "idx_audit_logs_executed_at" ON "server_audit_logs"("executed_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "server_audit_logs";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invite_servers";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invite_groups";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invites";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_server_access";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "server_groups";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_groups";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "groups";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tailscale_devices";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "minecraft_server_settings";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "servers";`);
  }
}
