export enum RouteAction {
  UPSERT = 0,
  DELETE = 1,
  STATUS_CHANGE = 2,
}

export enum SessionEventType {
  CONNECTED = 0,
  DISCONNECTED = 1,
  WAKE_REQUESTED = 2,
  ACCESS_DENIED = 3,
}

export interface RouteUpdateEvent {
  action: RouteAction;
  server_id: string;
  subdomain: string;
  target_ip_port: string;
  status: string; // STOPPED, STARTING, READY, MAINTENANCE
  access_policy: string; // PUBLIC, GROUP, INDIVIDUAL, MAINTENANCE, INTERNET
  allowed_group_ids: string[];
  allowed_user_ids: string[];
  proxy_protocol: boolean;
  game_type: string; // MINECRAFT, TERRARIA
  routing_model: string; // VirtualHost, DedicatedPort
  listen_port: number;
  auto_wake: boolean;
  /** `data:image/png;base64,...`; empty when the server has no icon. */
  favicon?: string;
  /** Display name of the world; the gateway shows it in the server list and in refusals. */
  name?: string;
  /** 0 when unknown: the gateway assumes 20. */
  max_players?: number;
  /** `pt-BR` or `en`: language of the texts the gateway shows the client. */
  language?: string;
}

export interface SessionLifecycleEvent {
  event_type: SessionEventType;
  session_id: string;
  server_id: string;
  client_ip: string;
  minecraft_nick: string;
  timestamp_epoch_ms: number;
  reason: string;
}

export interface GatewayCommand {
  command_id: string;
  revoke_session: RevokeSessionRequest;
}

export interface GatewayCommandResult {
  command_id: string;
  // Sem `defaults` no proto-loader, campos zerados chegam ausentes: um `{}` aqui é "0 sessões".
  revoke_session?: Partial<RevokeSessionResponse>;
  error?: string;
}

export interface RevokeSessionRequest {
  server_id: string;
  client_ip: string;
  minecraft_nick: string;
  reason_message: string;
}

export interface RevokeSessionResponse {
  session_found: boolean;
  terminated_connections_count: number;
}

export interface RoutingSnapshotResponse {
  routes: RouteUpdateEvent[];
}

export interface ResolvePlayerRequest {
  tailscale_user_id: string;
  node_id: string;
  client_ip: string;
  minecraft_nick?: string;
}

export interface ResolvePlayerResponse {
  found: boolean;
  user_id: string;
  minecraft_nick: string;
  role: string; // ADMIN, PLAYER
  group_ids: string[];
  is_active: boolean;
  is_mojang_verified: boolean;
}

export type Empty = Record<string, never>;
