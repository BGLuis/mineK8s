import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Server } from './server.entity';
import { User } from './user.entity';

export type ExecutionSource =
  | 'REST_API'
  | 'TERMINAL_SESSION'
  | 'SLEEP_MODE_WORKER'
  | 'BACKUP_ROUTINE'
  | 'HEALTH_BOT';

@Entity('server_audit_logs')
export class ServerAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  server_id: string;

  @ManyToOne(() => Server, (server) => server.audit_logs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'server_id' })
  server: Server;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'varchar', length: 500 })
  command: string;

  @Column({ type: 'varchar', length: 30 })
  execution_source: ExecutionSource;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address: string | null;

  @Column({ type: 'text', nullable: true })
  response: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  executed_at: Date;
}
