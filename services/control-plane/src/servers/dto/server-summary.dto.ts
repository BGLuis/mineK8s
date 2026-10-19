import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { ServerAccessPolicy, ServerState } from '@database/entities/server.entity';

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
  access_policy: ServerAccessPolicy;
  is_maintenance: boolean;
  auto_wake: boolean;
  sleep_timeout_minutes: number;
  stop_warning_minutes: number;
  backup_schedule_mode?: string;
  backup_interval_hours?: number | null;
  backup_daily_time?: string | null;
  backup_window_start?: string | null;
  backup_window_end?: string | null;
  backup_timezone?: string;
  backup_retention_count?: number;
  backup_next_run_at?: Date | null;
  created_at: Date;
  updated_at: Date;
  replicas?: number;
  ready_replicas?: number;
  players_online: number;
  active_countdown?: { taskId: string; action: string } | null;
}

/** Settings exposed to the panel: an explicit allow-list, so a new entity column is never leaked by default. */
export class ServerSettingsDto {
  motd: string;
  max_players: number;
  difficulty: string;
  gamemode: string;
  hardcore: boolean;
  pvp: boolean;
  spawn_protection: number;
  view_distance: number;
  simulation_distance: number;
  enable_rcon: boolean;
  rcon_port: number;
  enforce_secure_chat: boolean;
  online_mode: boolean;
  language: string;
}

export class ServerDetailDto extends ServerSummaryDto {
  /** Java major of the runner image; null for a server created before it was resolved. */
  java_version: number | null;
  /** Build of the installed jar (Paper, Purpur) and its release channel (Paper only). */
  server_build: string | null;
  server_build_channel: string | null;
  settings?: ServerSettingsDto;
}

export function toServerSettingsDto(settings: MinecraftServerSettings): ServerSettingsDto {
  return {
    motd: settings.motd,
    max_players: settings.max_players,
    difficulty: settings.difficulty,
    gamemode: settings.gamemode,
    hardcore: settings.hardcore,
    pvp: settings.pvp,
    spawn_protection: settings.spawn_protection,
    view_distance: settings.view_distance,
    simulation_distance: settings.simulation_distance,
    enable_rcon: settings.enable_rcon,
    rcon_port: settings.rcon_port,
    enforce_secure_chat: settings.enforce_secure_chat,
    online_mode: settings.online_mode,
    language: settings.language,
  };
}
