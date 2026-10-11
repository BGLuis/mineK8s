export class DatabaseConfig {
  constructor(
    public readonly host: string,
    public readonly port: number,
    public readonly user: string,
    public readonly pass: string,
    public readonly name: string,
    public readonly ssl: boolean,
    public readonly synchronize: boolean,
    public readonly logging: boolean,
    public readonly poolSize: number,
  ) {}
}

export class JwtConfig {
  constructor(
    public readonly secret: string,
    public readonly expiration: string,
    public readonly initialBootstrapToken?: string,
  ) {}
}

export class GrpcConfig {
  constructor(
    public readonly host: string = '0.0.0.0',
    public readonly port: number = 50051,
  ) {}
}

export class TailscaleConfig {
  constructor(
    public readonly socketPath: string,
    public readonly authEnabled: boolean,
    public readonly apiKey?: string,
    public readonly tailnetName?: string,
    public readonly trustedProxyIps: string[] = [],
    public readonly deviceLimit: number = 50,
    public readonly inviteKeyEnabled: boolean = false,
    public readonly nodeSharingEnabled: boolean = true,
  ) {}
}

export class AccessConfig {
  constructor(
    public readonly publicUrl: string,
    public readonly worldsDomain: string,
  ) {}
}

export class KubernetesConfig {
  constructor(
    public readonly inCluster: boolean,
    public readonly kubeconfig?: string,
    public readonly namespace: string = 'minekubernetes',
    public readonly nodeAffinityKey: string = 'kubernetes.io/hostname',
    public readonly nodeAffinityValue?: string,
    public readonly useMockDriver: boolean = false,
  ) {}
}

export class RegistryConfig {
  constructor(
    public readonly registryUrl: string,
    public readonly jvmRunnerImage: string,
    public readonly installerJobImage: string,
    public readonly controlPlaneImage: string,
    public readonly gatewayImage: string,
  ) {}
}

export class StorageConfig {
  constructor(
    public readonly serversDataRoot: string,
    public readonly sharedCachePath: string,
    public readonly backupsPath: string,
  ) {}
}

export class CloudflareConfig {
  constructor(
    public readonly apiToken?: string,
    public readonly zoneId?: string,
    public readonly rootDomain: string = 'minek8s.net',
  ) {}
}

export class HealthBotConfig {
  constructor(
    public readonly enabled: boolean = true,
    public readonly intervalMs: number = 300000,
    public readonly timeoutMs: number = 5000,
  ) {}
}

export class ModpackCatalogConfig {
  constructor(
    public readonly cacheTtlMs: number = 60000,
    public readonly requestTimeoutMs: number = 8000,
  ) {}
}

export class ServerJarSourcesConfig {
  constructor(
    public readonly mojangManifestUrl: string,
    public readonly paperApiUrl: string,
    public readonly purpurApiUrl: string,
  ) {}
}
