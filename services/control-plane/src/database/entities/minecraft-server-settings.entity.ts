import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { Server } from './server.entity';

@Entity('minecraft_server_settings')
export class MinecraftServerSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  server_id: string;

  @OneToOne('Server', 'minecraft_settings', {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'server_id' })
  server: Server;

  @Column({ type: 'varchar', length: 255, default: 'A MineKubernetes Server' })
  motd: string;

  @Column({ type: 'int', default: 20 })
  max_players: number;

  @Column({ type: 'varchar', length: 20, default: 'normal' })
  difficulty: string;

  @Column({ type: 'varchar', length: 20, default: 'survival' })
  gamemode: string;

  @Column({ type: 'boolean', default: false })
  hardcore: boolean;

  @Column({ type: 'boolean', default: true })
  pvp: boolean;

  @Column({ type: 'int', default: 16 })
  spawn_protection: number;

  @Column({ type: 'int', default: 10 })
  view_distance: number;

  @Column({ type: 'int', default: 10 })
  simulation_distance: number;

  @Column({ type: 'boolean', default: true })
  enable_rcon: boolean;

  @Column({ type: 'int', default: 25575 })
  rcon_port: number;

  @Column({ type: 'varchar', length: 100 })
  rcon_password: string;

  @Column({ type: 'boolean', default: false })
  enforce_secure_chat: boolean;

  @Column({ type: 'boolean', default: false })
  online_mode: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
