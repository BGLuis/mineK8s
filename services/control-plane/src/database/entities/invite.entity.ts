import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { InviteGroup } from './invite-group.entity';
import type { InviteServer } from './invite-server.entity';

@Entity('invites')
export class Invite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_invites_token', { unique: true })
  @Column({ type: 'varchar', length: 64, unique: true })
  token: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'int', default: 1 })
  max_uses: number;

  @Column({ type: 'int', default: 0 })
  used_count: number;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @OneToMany('InviteGroup', 'invite')
  invite_groups: InviteGroup[];

  @OneToMany('InviteServer', 'invite')
  invite_servers: InviteServer[];
}
