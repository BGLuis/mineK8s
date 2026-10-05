import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { TailscaleDevice } from './tailscale-device.entity';
import type { UserGroup } from './user-group.entity';
import type { UserServerAccess } from './user-server-access.entity';

export type UserRole = 'ADMIN' | 'PLAYER';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  real_name: string | null;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  email: string | null;

  @Index('idx_users_minecraft_nick', { unique: true })
  @Column({ type: 'varchar', length: 16, unique: true })
  minecraft_nick: string;

  @Index('uq_users_tailscale_user_id', { unique: true, where: '"tailscale_user_id" IS NOT NULL' })
  @Column({ type: 'varchar', length: 100, nullable: true })
  tailscale_user_id: string | null;

  @Column({ type: 'varchar', length: 20, default: 'PLAYER' })
  role: UserRole;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany('TailscaleDevice', 'user')
  devices: TailscaleDevice[];

  @OneToMany('UserGroup', 'user')
  user_groups: UserGroup[];

  @OneToMany('UserServerAccess', 'user')
  server_accesses: UserServerAccess[];
}
