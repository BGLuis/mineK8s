import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** One panel setting that overrides the environment. Secret values are stored encrypted (see SecretCipher). */
@Entity('app_settings')
export class AppSetting {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'boolean', default: false })
  is_secret: boolean;

  @Column({ type: 'varchar', length: 16, nullable: true })
  updated_by: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
