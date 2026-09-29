import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { Group } from './group.entity';
import { User } from './user.entity';

@Entity('user_groups')
export class UserGroup {
  @PrimaryColumn({ type: 'uuid' })
  user_id: string;

  @PrimaryColumn({ type: 'uuid' })
  group_id: string;

  @ManyToOne(() => User, (user) => user.user_groups, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Group, (group) => group.user_groups, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group: Group;
}
