import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { Invite } from './invite.entity';
import { Server } from './server.entity';

@Entity('invite_servers')
export class InviteServer {
  @PrimaryColumn({ type: 'uuid' })
  invite_id: string;

  @PrimaryColumn({ type: 'uuid' })
  server_id: string;

  @ManyToOne(
    () => Invite,
    (invite) => invite.invite_servers,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'invite_id' })
  invite: Invite;

  @ManyToOne(() => Server, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'server_id' })
  server: Server;
}
