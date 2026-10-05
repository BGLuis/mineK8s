import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from './user.entity';

export type DeviceStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';

@Entity('tailscale_devices')
export class TailscaleDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(
    () => User,
    (user) => user.devices,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 100, unique: true, nullable: true })
  node_id: string | null;

  @Index('idx_devices_node_ip')
  @Column({ type: 'varchar', length: 45, nullable: true })
  node_ip: string | null;

  @Index('idx_devices_tailscale_tag', { unique: true })
  @Column({ type: 'varchar', length: 100, unique: true })
  tailscale_tag: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  device_name: string | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: DeviceStatus;

  @Column({ type: 'timestamptz', nullable: true })
  last_seen_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
