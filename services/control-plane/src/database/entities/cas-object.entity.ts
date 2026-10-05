import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('cas_objects')
@Index(['lastAccessedAt'])
export class CasObjectEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  sha256: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  sha1?: string | null;

  @Column({
    name: 'file_size',
    type: 'bigint',
    transformer: {
      to: (value: number) => value,
      from: (value: string | number) => Number(value) || 0,
    },
  })
  fileSize: number;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({
    name: 'content_type',
    type: 'varchar',
    length: 100,
    default: 'application/java-archive',
  })
  contentType: string;

  @Column({ name: 'storage_path', type: 'varchar', length: 500 })
  storagePath: string;

  @Column({ name: 'last_accessed_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  lastAccessedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
