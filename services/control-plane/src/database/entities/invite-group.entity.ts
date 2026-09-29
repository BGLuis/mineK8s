import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { Group } from './group.entity';
import { Invite } from './invite.entity';

@Entity('invite_groups')
export class InviteGroup {
  @PrimaryColumn({ type: 'uuid' })
  invite_id: string;

  @PrimaryColumn({ type: 'uuid' })
  group_id: string;

  @ManyToOne(() => Invite, (invite) => invite.invite_groups, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invite_id' })
  invite: Invite;

  @ManyToOne(() => Group, (group) => group.invite_groups, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group: Group;
}
