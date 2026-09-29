import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ModpackTaskStatus {
  QUEUED = 'QUEUED',
  RESOLVING = 'RESOLVING',
  DOWNLOADING = 'DOWNLOADING',
  APPLYING_OVERRIDES = 'APPLYING_OVERRIDES',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('modpack_install_tasks')
export class ModpackTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'server_id', type: 'uuid' })
  serverId: string;

  @Column({ type: 'varchar', length: 32 })
  source: 'CURSEFORGE' | 'MODRINTH' | 'VANILLA' | 'CUSTOM';

  @Column({ name: 'project_id', type: 'varchar', length: 128 })
  projectId: string;

  @Column({ name: 'version_id', type: 'varchar', length: 128 })
  versionId: string;

  @Column({ type: 'varchar', length: 32, default: ModpackTaskStatus.QUEUED })
  status: ModpackTaskStatus;

  @Column({ name: 'progress_percent', type: 'smallint', default: 0 })
  progressPercent: number;

  @Column({
    name: 'current_step',
    type: 'varchar',
    length: 255,
    default: 'Aguardando escalonamento...',
  })
  currentStep: string;

  @Column({ name: 'downloaded_files', type: 'int', default: 0 })
  downloadedFiles: number;

  @Column({ name: 'total_files', type: 'int', default: 0 })
  totalFiles: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null;

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
