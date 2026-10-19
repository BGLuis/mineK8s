import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EffectiveSettings } from '../settings/settings.types';
import {
  AccessConfig,
  DatabaseConfig,
  GrpcConfig,
  JwtConfig,
  KubernetesConfig,
  RegistryConfig,
  StorageConfig,
  TailscaleConfig,
  CloudflareConfig,
  HealthBotConfig,
  ModpackCatalogConfig,
  ServerJarSourcesConfig,
} from './app-config.values';

@Injectable()
export class AppConfigService {
  private settings?: EffectiveSettings;

  constructor(private readonly config: ConfigService) {}

  /**
   * Makes `tailscale`, `access`, `cloudflare` and `healthBot` follow the settings edited on the panel (database,
   * then environment, then default). Attached by SettingsService, which depends on this class and cannot be injected.
   */
  attachSettings(settings: EffectiveSettings): void {
    this.settings = settings;
  }

  private parseCsv(value?: string): string[] {
    return (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  get port(): number {
    return this.config.get<number>('PORT', 3000);
  }

  get apiUrl(): string {
    return this.config.get<string>('API_URL', 'http://localhost:3000');
  }

  get appUrl(): string {
    return this.config.get<string>('APP_URL', 'http://localhost:4200');
  }

  get allowedOrigins(): string[] {
    const configured = this.parseCsv(this.config.get<string>('ALLOWED_ORIGINS'));
    return configured.length > 0 ? configured : [this.appUrl];
  }

  /** Peers allowed to vouch for X-Forwarded-For and X-Tailscale-User. Empty (trust nobody) unless configured. */
  get authTrustedProxyIps(): string[] {
    return this.parseCsv(this.config.get<string>('AUTH_TRUSTED_PROXY_IPS'));
  }

  /** Directory with the services/web production build (the one holding index.html). */
  get webDistDir(): string | undefined {
    return this.config.get<string>('WEB_DIST_DIR') || undefined;
  }

  get enableSwagger(): boolean {
    return this.config.get<boolean>('ENABLE_SWAGGER', true);
  }

  get logLevel(): string {
    return this.config.get<string>('LOG_LEVEL', 'context=*;level=info');
  }

  get reconciliationIntervalMs(): number {
    return this.config.get<number>('RECONCILIATION_INTERVAL_MS', 30000);
  }

  get database(): DatabaseConfig {
    return new DatabaseConfig(
      this.config.get<string>('DB_HOST', 'localhost'),
      this.config.get<number>('DB_PORT', 5432),
      this.config.get<string>('DB_USER', 'minek8s'),
      this.config.get<string>('DB_PASSWORD', ''),
      this.config.get<string>('DB_NAME', 'minekubernetes'),
      this.config.get<boolean>('DB_SSL', false),
      this.config.get<boolean>('DB_SYNCHRONIZE', false),
      this.config.get<boolean>('DB_LOGGING', false),
      this.config.get<number>('DB_POOL_SIZE', 10),
    );
  }

  get jwt(): JwtConfig {
    return new JwtConfig(
      this.config.get<string>('JWT_SECRET', ''),
      this.config.get<string>('JWT_EXPIRATION', '1d'),
      this.config.get<string>('INITIAL_BOOTSTRAP_TOKEN'),
    );
  }

  get grpc(): GrpcConfig {
    return new GrpcConfig(
      this.config.get<string>('GRPC_HOST', '0.0.0.0'),
      this.config.get<number>('GRPC_PORT', 50051),
    );
  }

  get tailscale(): TailscaleConfig {
    const settings = this.settings;
    return new TailscaleConfig(
      this.config.get<string>('TAILSCALE_SOCKET_PATH', '/run/tailscale/tailscaled.sock'),
      this.config.get<boolean>('TAILSCALE_AUTH_ENABLED', true),
      settings
        ? settings.getString('tailscale.apiKey') || undefined
        : this.config.get<string>('TAILSCALE_API_KEY'),
      settings ? settings.getString('tailscale.tailnet') : this.config.get<string>('TAILNET_NAME'),
      this.parseCsv(this.config.get<string>('TRUSTED_PROXY_IPS')),
      this.config.get<number>('TAILNET_DEVICE_LIMIT', 50),
      settings
        ? settings.getBoolean('tailscale.inviteKeyEnabled')
        : this.config.get<boolean>('TAILSCALE_INVITE_KEY_ENABLED', false),
      settings
        ? settings.getBoolean('tailscale.nodeSharingEnabled')
        : this.config.get<boolean>('TAILSCALE_NODE_SHARING_ENABLED', true),
    );
  }

  get access(): AccessConfig {
    const settings = this.settings;
    return new AccessConfig(
      settings
        ? settings.getString('access.publicUrl')
        : this.config.get<string>('PUBLIC_BASE_URL', 'http://localhost:3000'),
      settings
        ? settings.getString('access.worldsDomain')
        : this.config.get<string>('WORLDS_BASE_DOMAIN', ''),
    );
  }

  get kubernetes(): KubernetesConfig {
    return new KubernetesConfig(
      this.config.get<boolean>('KUBERNETES_IN_CLUSTER', false),
      this.config.get<string>('KUBECONFIG'),
      this.config.get<string>('KUBERNETES_NAMESPACE', 'minekubernetes'),
      this.config.get<string>('KUBERNETES_NODE_AFFINITY_KEY', 'kubernetes.io/hostname'),
      this.config.get<string>('KUBERNETES_NODE_AFFINITY_VALUE'),
      this.config.get<boolean>('KUBERNETES_USE_MOCK_DRIVER', false),
    );
  }

  get registry(): RegistryConfig {
    return new RegistryConfig(
      this.config.get<string>('REGISTRY_URL', 'docker.io'),
      this.config.get<string>('IMAGE_JVM_RUNNER', 'eclipse-temurin:{java}-jre-jammy'),
      this.config.get<string>('IMAGE_INSTALLER_JOB', 'minekubernetes/installer:latest'),
      this.config.get<string>('IMAGE_CONTROL_PLANE', 'minekubernetes/control-plane:latest'),
      this.config.get<string>('IMAGE_GATEWAY', 'minekubernetes/gateway:latest'),
    );
  }

  get storage(): StorageConfig {
    return new StorageConfig(
      this.config.get<string>('SERVERS_DATA_ROOT', './storage/servers'),
      this.config.get<string>('SHARED_CACHE_PATH', '/cache'),
      this.config.get<string>('BACKUPS_PATH', '/backups'),
    );
  }

  get cloudflare(): CloudflareConfig {
    const settings = this.settings;
    return new CloudflareConfig(
      settings
        ? settings.getString('cloudflare.apiToken') || undefined
        : this.config.get<string>('CLOUDFLARE_API_TOKEN'),
      settings
        ? settings.getString('cloudflare.zoneId') || undefined
        : this.config.get<string>('CLOUDFLARE_ZONE_ID'),
      settings
        ? settings.getString('cloudflare.rootDomain')
        : this.config.get<string>('CLOUDFLARE_ROOT_DOMAIN', 'minek8s.net'),
    );
  }

  get healthBot(): HealthBotConfig {
    const settings = this.settings;
    return new HealthBotConfig(
      settings
        ? settings.getBoolean('healthBot.enabled')
        : this.config.get<boolean>('HEALTH_BOT_ENABLED', true),
      settings
        ? settings.getNumber('healthBot.intervalMs')
        : this.config.get<number>('HEALTH_BOT_INTERVAL_MS', 300000),
      settings
        ? settings.getNumber('healthBot.timeoutMs')
        : this.config.get<number>('HEALTH_BOT_TIMEOUT_MS', 5000),
    );
  }

  get serverStatsIntervalMs(): number {
    return this.config.get<number>('SERVER_STATS_INTERVAL_MS', 60000);
  }

  get modpackCatalog(): ModpackCatalogConfig {
    return new ModpackCatalogConfig(
      this.config.get<number>('MODPACK_CATALOG_CACHE_TTL_MS', 60000),
      this.config.get<number>('MODPACK_CATALOG_TIMEOUT_MS', 8000),
    );
  }

  get serverJarSources(): ServerJarSourcesConfig {
    return new ServerJarSourcesConfig(
      this.config.get<string>(
        'MOJANG_VERSION_MANIFEST_URL',
        'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
      ),
      this.config.get<string>('PAPER_API_URL', 'https://fill.papermc.io'),
      this.config.get<string>('PURPUR_API_URL', 'https://api.purpurmc.org'),
      this.config.get<string>('FABRIC_META_URL', 'https://meta.fabricmc.net'),
      this.config.get<string>('NEOFORGE_MAVEN_URL', 'https://maven.neoforged.net'),
      this.config.get<string>(
        'FORGE_PROMOTIONS_URL',
        'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
      ),
    );
  }
}
