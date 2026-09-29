import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Server } from './server.entity';

export enum BackupType {
  HOT_SCHEDULED = 'HOT_SCHEDULED',
  COLD_MANUAL = 'COLD_MANUAL',
  PRE_UPDATE = 'PRE_UPDATE',
  PRE_RESTORE = 'PRE_RESTORE',
}

export enum BackupStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('server_backups')
@Index(['serverId', 'createdAt'])
export class ServerBackupEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'server_id', type: 'uuid' })
  serverId: string;

  @ManyToOne(() => Server, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'server_id' })
  server: Server;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ name: 'storage_path', type: 'varchar', length: 500 })
  storagePath: string;

  @Column({
    name: 'size_bytes',
    type: 'bigint',
    transformer: {
      to: (value: number) => value,
      from: (value: string | number) => Number(value) || 0,
    },
  })
  sizeBytes: number;

  @Column({ name: 'sha256_checksum', type: 'varchar', length: 64 })
  sha256Checksum: string;

  @Column({ name: 'backup_type', type: 'varchar', length: 32 })
  backupType: BackupType;

  @Column({ type: 'varchar', length: 32, default: BackupStatus.PENDING })
  status: BackupStatus;

  @Column({ name: 'is_protected', type: 'boolean', default: false })
  isProtected: boolean;

  @Column({ name: 'minecraft_version', type: 'varchar', length: 32, default: 'unknown' })
  minecraftVersion: string;

  @Column({ name: 'modpack_version', type: 'varchar', length: 64, nullable: true })
  modpackVersion?: string | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'retention_expires_at', type: 'timestamptz', nullable: true })
  retentionExpiresAt?: Date | null;
}
