import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { Server } from './server.entity';
import { User } from './user.entity';

@Entity('user_server_access')
export class UserServerAccess {
  @PrimaryColumn({ type: 'uuid' })
  user_id: string;

  @PrimaryColumn({ type: 'uuid' })
  server_id: string;

  @ManyToOne(() => User, (user) => user.server_accesses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Server, (server) => server.user_accesses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'server_id' })
  server: Server;

  @CreateDateColumn({ type: 'timestamptz' })
  granted_at: Date;
}
