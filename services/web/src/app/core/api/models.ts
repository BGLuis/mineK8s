/**
 * Frontend models mirroring the control-plane DTOs and entities
 * (services/control-plane/src). Dates arrive as ISO strings over JSON.
 */

export type ServerState =
  | 'PROVISIONING'
  | 'STARTING'
  | 'READY'
  | 'STOPPING'
  | 'STOPPED'
  | 'UPDATING'
  | 'CRASHED'
  | 'FAILED';

export type ServerAccessPolicy = 'PUBLIC' | 'GROUP' | 'INDIVIDUAL' | 'MAINTENANCE' | 'INTERNET';

export type ServerType = 'PAPER' | 'PURPUR' | 'VANILLA' | 'FABRIC' | 'FORGE' | 'NEOFORGE';

export type UserRole = 'ADMIN' | 'PLAYER';

/** ServerSummaryDto (servers/dto/server-summary.dto.ts). */
export interface ServerSummary {
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
  created_at: string;
  updated_at: string;
  replicas?: number;
  ready_replicas?: number;
}

/** ServerSettingsDto (servers/dto/server-summary.dto.ts). The RCON password is never sent. */
export interface MinecraftServerSettings {
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
}

/** GET /api/servers/:id. */
export interface ServerDetail extends ServerSummary {
  settings?: MinecraftServerSettings;
}

export interface MinecraftSettingsInput {
  motd?: string;
  max_players?: number;
  difficulty?: 'peaceful' | 'easy' | 'normal' | 'hard';
  gamemode?: 'survival' | 'creative' | 'adventure' | 'spectator';
  hardcore?: boolean;
  pvp?: boolean;
  spawn_protection?: number;
  view_distance?: number;
  simulation_distance?: number;
  rcon_password?: string;
  enforce_secure_chat?: boolean;
  online_mode?: boolean;
}

/** CreateServerDto (servers/dto/create-server.dto.ts). */
export interface CreateServerRequest {
  name: string;
  subdomain: string;
  game_type?: string;
  routing_model?: 'sni-shared-port' | 'dedicated-port';
  allocated_port?: number;
  server_type?: ServerType;
  game_version?: string;
  modpack_id?: string;
  allocated_memory_mb?: number;
  auto_wake?: boolean;
  sleep_timeout_minutes?: number;
  access_policy?: ServerAccessPolicy;
  minecraft_settings?: MinecraftSettingsInput;
}

export interface CreateServerResponse {
  id: string;
  name: string;
  subdomain: string;
  status: ServerState;
}

export interface UpdateVersionRequest {
  game_version: string;
  server_type?: string;
  modpack_id?: string;
  purge_mods?: boolean;
}

export interface UpdateVersionResponse {
  message: string;
  version: string;
  rolledBack: boolean;
}

export interface MessageResponse {
  message: string;
}

export interface PublishResponse {
  id: string;
  subdomain: string;
  access_policy: ServerAccessPolicy;
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/** circular-log-buffer.ts. */
export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
}

export interface ServerLogsResponse {
  logs: string;
  lines: LogEntry[];
}

export interface CommandResponse {
  success: boolean;
  serverId: string;
  command: string;
  response: string;
  executionTimeMs: number;
}

/** FileItemDto. */
export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

export interface FileListing {
  path: string;
  files: FileItem[];
}

export interface FileContent {
  path: string;
  content: string;
}

export interface WorldUploadResponse {
  message: string;
  extractedCount: number;
}

/* ---------------------------------------------------------------- backups */

export type BackupType = 'HOT_SCHEDULED' | 'COLD_MANUAL' | 'PRE_UPDATE' | 'PRE_RESTORE';
export type BackupStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
export type BackupMode = 'HOT' | 'COLD';

/** ServerBackupDto. */
export interface ServerBackup {
  id: string;
  serverId: string;
  filename: string;
  sizeBytes: number;
  sha256Checksum: string;
  backupType: BackupType;
  status: BackupStatus;
  isProtected: boolean;
  minecraftVersion: string;
  modpackVersion?: string | null;
  createdAt: string;
  retentionExpiresAt?: string | null;
}

export interface CreateBackupResponse {
  taskId: string;
  backupId: string;
  result: {
    backupId: string;
    serverId: string;
    filename: string;
    storagePath: string;
    backupType: BackupMode;
    sizeBytes: number;
    sha256Checksum: string;
    freezeDurationMs?: number;
  };
}

export interface RestoreBackupResponse {
  taskId: string;
  message: string;
}

export interface DeleteBackupResponse {
  message: string;
  backupId: string;
}

/* --------------------------------------------------------------- modpacks */

export type ModpackSource = 'MODRINTH' | 'CURSEFORGE' | 'VANILLA' | 'CUSTOM';

/** UniversalModpackDto. */
export interface Modpack {
  id: string;
  name: string;
  summary: string;
  source: ModpackSource;
  author?: string;
  iconUrl?: string;
  downloads: number;
  gameVersion?: string;
  loader?: string;
  dateModified?: string;
}

export interface ModpackSearchResponse {
  total: number;
  results: Modpack[];
}

/** ModpackVersionDto. */
export interface ModpackVersion {
  id: string;
  name: string;
  gameVersion: string;
  loader: string;
  releaseType: string;
  datePublished: string;
  downloadUrl?: string;
}

export interface InstallModpackRequest {
  source: ModpackSource;
  projectId: string;
  versionId: string;
  archiveUrl?: string;
}

export interface InstallModpackResponse {
  taskId: string;
  status: string;
  message: string;
}

/** Payload of the `taskProgress` event on `/ws/tasks` (tasks.gateway.ts). */
export interface TaskProgress {
  taskId: string;
  serverId: string;
  status: string;
  progressPercent: number;
  downloadedFiles: number;
  totalFiles: number;
  currentStep: string;
  speedBytesPerSec?: number;
}

/* ------------------------------------------------------------- tailscale */

export type InviteStatus = 'Active' | 'Depleted' | 'Expired' | 'Revoked';

/** InviteSummaryDto. */
export interface InviteSummary {
  id: string;
  token: string;
  name: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  status: InviteStatus;
  joinUrl: string;
  groupIds: string[];
  serverIds: string[];
  /** Only filled by the public validation endpoint. */
  serverNames?: string[];
  createdBy?: string | null;
  createdAt: string;
}

/** CreateInviteDto. */
export interface CreateInviteRequest {
  name: string;
  maxUses?: number;
  expiresInDays?: number;
  groupIds?: string[];
  serverIds?: string[];
}

/** ClaimInviteDto. */
export interface ClaimInviteRequest {
  token: string;
  realName: string;
  minecraftNick: string;
}

/** ClaimResultDto. */
export interface ClaimResult {
  userId: string;
  realName: string;
  minecraftNick: string;
  authKey: string;
  deepLinkUrl: string;
  tailcatTunnel?: { serverAddress: string; instructions: string };
  expiresAt: string;
}

export type DeviceStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';

/** users entity. */
export interface User {
  id: string;
  real_name: string | null;
  email: string | null;
  minecraft_nick: string;
  tailscale_user_id: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

/** GET /api/admin/users. */
export interface UserSummary {
  id: string;
  minecraftNick: string;
  realName: string | null;
  role: UserRole;
  devices: { id: string; deviceName: string | null; status: DeviceStatus; lastSeenAt: string | null }[];
  groupIds: string[];
}

/** GET /api/admin/users/:id/servers: servers the user may join, by the gateway's own access rules. */
export interface AccessibleServer {
  id: string;
  name: string;
  subdomain: string;
  state: ServerState;
}

/** tailscale_devices entity, with the `user` relation loaded by DevicesService. */
export interface TailscaleDevice {
  id: string;
  user_id: string;
  user?: User;
  node_id: string | null;
  node_ip: string | null;
  tailscale_tag: string;
  device_name: string | null;
  status: DeviceStatus;
  last_seen_at: string | null;
  created_at: string;
}

export interface RevokeDeviceResponse {
  message: string;
  deviceId: string;
}

export interface DeviceGcResponse {
  removedCount: number;
  removedDeviceIds: string[];
}

export type SecurityPostureStatus = 'COMPLIANT' | 'VULNERABLE' | 'WARNING' | 'ERROR';
export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface PostureFinding {
  severity: FindingSeverity;
  ruleIndex?: number;
  description: string;
  rawRule?: unknown;
}

export interface PolicyTestOutcome {
  src: string;
  target: string;
  expected: 'accept' | 'deny';
  passed: boolean;
  detail?: string;
}

/** PostureAuditReport. */
export interface PostureAuditReport {
  status: SecurityPostureStatus;
  timestamp: string;
  isTailnetLiveChecked: boolean;
  policySource: 'cloud_api' | 'local_file' | 'memory';
  findings: PostureFinding[];
  testedRulesSummary: {
    totalRules: number;
    wildcardPlayerFound: boolean;
    onlyGamePortExposed: boolean;
    testsPassed: number;
    testsFailed: number;
  };
  policyTestsResults?: PolicyTestOutcome[];
}

/* ----------------------------------------------------------------- admin */

/** groups entity with the relations loaded by AdminService.listGroups. */
export interface Group {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  user_groups: { user_id: string; group_id: string }[];
  server_groups: { server_id: string; group_id: string }[];
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
}

export interface SmartKickRequest {
  serverId: string;
  minecraftNick: string;
  reason?: string;
}

export interface SuccessResponse {
  success: boolean;
}

export interface RemoveUserFromGroupResponse {
  kickedServers: string[];
}

/* ---------------------------------------------------------------- health */

export interface HealthBotLatencies {
  tcpConnectMs: number;
  handshakeLatencyMs: number;
  loginLatencyMs: number;
  spawnLatencyMs?: number;
  totalDurationMs: number;
}

export interface HealthBotReport {
  id: string;
  serverId: string;
  subdomain: string;
  timestamp: string;
  healthy: boolean;
  stage: 'spawn_verified' | 'encryption_challenge' | 'login_success' | 'failed';
  onlineMode: boolean;
  latencies: HealthBotLatencies;
  worldDetails?: {
    dimension?: string;
    gameType?: string;
    isHardcore?: boolean;
    entityId?: number;
  };
  error?: string;
}

export interface HealthBotServerOverview {
  serverId: string;
  subdomain: string;
  state: string;
  totalChecks: number;
  successfulChecks: number;
  uptimePercentage: number;
  avgTotalDurationMs: number;
  latestReport?: HealthBotReport;
}

export interface HealthBotOverview {
  totalMonitoredServers: number;
  healthyServers: number;
  unhealthyServers: number;
  servers: Record<string, HealthBotServerOverview>;
}

/** ReconciliationSummary, or the idle placeholder returned before the first run. */
export interface ReconciliationSummary {
  checked: number;
  healedDeployments: string[];
  reconciledReplicas: string[];
  stateTransitions: string[];
  durationMs: number;
  timestamp: string;
}

export interface ReconcilerIdle {
  status: 'idle';
  message: string;
}

export type ReconcilerStatus = ReconciliationSummary | ReconcilerIdle;

/* ------------------------------------------------------------------ auth */

export interface BootstrapRequest {
  bootstrap_token: string;
  minecraft_nick: string;
  email?: string;
  real_name?: string;
}

export interface TokenResponse {
  access_token: string;
  user: User;
}

export interface BootstrapResponse extends TokenResponse {
  message: string;
}

/* ------------------------------------------------- mock-only (no endpoint) */

export interface NodeMetrics {
  cpuPercent: number;
  cpuLabel: string;
  ramPercent: number;
  ramLabel: string;
  nvmePercent: number;
  nvmeLabel: string;
  tailnetDevices: { used: number; limit: number };
}

export interface ServerRuntimeStats {
  tps: number;
  jvmUsedMb: number;
  jvmMaxMb: number;
  uptimeSeconds: number;
}

/** GET /api/servers/:id/players. */
export interface OnlinePlayer {
  nick: string;
  ip: string;
  connectedAt: string;
}

export interface ServerPlayers {
  online: number;
  max: number;
  players: OnlinePlayer[];
}

export interface DiskAlert {
  level: 'warning' | 'danger';
  percent: number;
}

/** PATCH /api/servers/:id. INTERNET is not accepted here: publishing goes through /publish. */
export interface UpdateServerRequest {
  /** A running server restarts to pick up the new heap. */
  allocated_memory_mb?: number;
  sleep_timeout_minutes?: number;
  auto_wake?: boolean;
  is_maintenance?: boolean;
  access_policy?: Exclude<ServerAccessPolicy, 'INTERNET'>;
}
