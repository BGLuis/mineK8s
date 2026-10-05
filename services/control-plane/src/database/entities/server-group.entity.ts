import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { Group } from './group.entity';
import { Server } from './server.entity';

@Entity('server_groups')
export class ServerGroup {
  @PrimaryColumn({ type: 'uuid' })
  server_id: string;

  @PrimaryColumn({ type: 'uuid' })
  group_id: string;

  @ManyToOne(
    () => Server,
    (server) => server.server_groups,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'server_id' })
  server: Server;

  @ManyToOne(
    () => Group,
    (group) => group.server_groups,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'group_id' })
  group: Group;
}
