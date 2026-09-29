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
  access_policy: string; // PUBLIC, GROUP, INDIVIDUAL, MAINTENANCE
  allowed_group_ids: string[];
  allowed_user_ids: string[];
  proxy_protocol: boolean;
  game_type: string; // MINECRAFT, TERRARIA
  routing_model: string; // VirtualHost, DedicatedPort
  listen_port: number;
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

export interface Empty {}
