import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { MinecraftServerSettings } from './minecraft-server-settings.entity';
import type { ServerAuditLog } from './server-audit-log.entity';
import type { ServerGroup } from './server-group.entity';
import type { UserServerAccess } from './user-server-access.entity';

export type ServerState =
  | 'PROVISIONING'
  | 'STARTING'
  | 'READY'
  | 'STOPPING'
  | 'STOPPED'
  | 'UPDATING'
  | 'CRASHED'
  | 'FAILED';

export type ServerAccessPolicy = 'PUBLIC' | 'GROUP' | 'INDIVIDUAL' | 'MAINTENANCE' | 'INTERNET';

@Entity('servers')
export class Server {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 63, unique: true })
  subdomain: string;

  /**
   * Stable name behind every Kubernetes resource and the data directory of this server. The subdomain is only an
   * address and can change; this never does, so a renamed server keeps finding its own Deployment, Service and PVC.
   */
  @Index('uq_servers_resource_name', { unique: true })
  @Column({ type: 'varchar', length: 63 })
  resource_name: string;

  @Column({ type: 'varchar', length: 30, default: 'minecraft' })
  game_type: string;

  @Column({ type: 'varchar', length: 30, default: 'subdomain' })
  routing_model: string;

  @Column({ type: 'int', nullable: true })
  allocated_port: number | null;

  @Column({ type: 'varchar', length: 30 })
  server_type: string;

  @Column({ type: 'varchar', length: 20 })
  game_version: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  modpack_id: string | null;

  /** Java major of the runner image, chosen when the version was resolved; null on servers created before that. */
  @Column({ type: 'int', nullable: true })
  java_version: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  server_jar_url: string | null;

  /** `<algorithm>:<hex digest>` of server_jar_url, e.g. `sha256:5ffe...`. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  server_jar_checksum: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  server_build: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  server_build_channel: string | null;

  @Column({ type: 'int', default: 4096 })
  allocated_memory_mb: number;

  @Column({ type: 'varchar', length: 20, default: 'STOPPED' })
  state: ServerState;

  @Column({ type: 'varchar', length: 20, default: 'GROUP' })
  access_policy: ServerAccessPolicy;

  @Column({ type: 'boolean', default: false })
  is_maintenance: boolean;

  @Column({ type: 'boolean', default: true })
  auto_wake: boolean;

  @Column({ type: 'int', default: 15 })
  sleep_timeout_minutes: number;

  @Column({ type: 'int', default: 10 })
  stop_warning_minutes: number;

  @Column({ type: 'int', default: 0 })
  restart_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_restart_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_player_active_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToOne('MinecraftServerSettings', 'server', { cascade: true })
  minecraft_settings?: MinecraftServerSettings;

  @OneToMany('ServerGroup', 'server')
  server_groups: ServerGroup[];

  @OneToMany('UserServerAccess', 'server')
  user_accesses: UserServerAccess[];

  @OneToMany('ServerAuditLog', 'server')
  audit_logs: ServerAuditLog[];
}
