import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Server } from './server.entity';

export type ServerContentOrigin = 'MODPACK' | 'MANUAL';
export type ServerContentSource = 'MODRINTH' | 'CURSEFORGE';

@Entity('server_content')
@Index('uq_server_content_server_path', ['serverId', 'path'], { unique: true })
export class ServerContent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'server_id', type: 'uuid' })
  serverId: string;

  @ManyToOne(() => Server, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'server_id' })
  server?: Server;

  @Column({ type: 'varchar', length: 500 })
  path: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  sha1: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  sha512: string | null;

  @Column({ type: 'varchar', length: 20, default: 'MANUAL' })
  origin: ServerContentOrigin;

  @Column({ type: 'varchar', length: 20, nullable: true })
  source: ServerContentSource | null;

  @Column({ name: 'project_id', type: 'varchar', length: 100, nullable: true })
  projectId: string | null;

  @Column({ name: 'version_id', type: 'varchar', length: 100, nullable: true })
  versionId: string | null;

  @Column({ type: 'simple-array', nullable: true })
  loaders: string[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
