import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { InviteGroup } from './invite-group.entity';
import type { ServerGroup } from './server-group.entity';
import type { UserGroup } from './user-group.entity';

@Entity('groups')
export class Group {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80, unique: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @OneToMany('UserGroup', 'group')
  user_groups: UserGroup[];

  @OneToMany('ServerGroup', 'group')
  server_groups: ServerGroup[];

  @OneToMany('InviteGroup', 'group')
  invite_groups: InviteGroup[];
}
