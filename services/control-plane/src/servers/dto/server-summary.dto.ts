import { ServerState } from '@database/entities/server.entity';

export class ServerSummaryDto {
  id: string;
  name: string;
  subdomain: string;
  game_type: string;
  routing_model: string;
  server_type: string;
  game_version: string;
  allocated_memory_mb: number;
  allocated_port: number | null;
  state: ServerState;
  is_maintenance: boolean;
  auto_wake: boolean;
  sleep_timeout_minutes: number;
  created_at: Date;
  updated_at: Date;
  replicas?: number;
  ready_replicas?: number;
}
