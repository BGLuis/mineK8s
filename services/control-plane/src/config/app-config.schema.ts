import * as Joi from 'joi';

export const appConfigSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development')
    .description('Environment mode'),
  PORT: Joi.number().port().default(3000),
  GRPC_PORT: Joi.number().port().default(50051),
  GRPC_HOST: Joi.string().default('0.0.0.0'),
  API_URL: Joi.string().uri().default('http://localhost:3000'),
  APP_URL: Joi.string().uri().default('http://localhost:4200'),
  ALLOWED_ORIGINS: Joi.string().default('http://localhost:4200'),
  ENABLE_SWAGGER: Joi.boolean().default(true),

  // Database PostgreSQL 16
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().port().default(5432),
  DB_USER: Joi.string().required().description('PostgreSQL database user'),
  DB_PASSWORD: Joi.string().required().description('PostgreSQL database password'),
  DB_NAME: Joi.string().required().description('PostgreSQL database name'),
  DB_SSL: Joi.boolean().default(false),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),
  DB_POOL_SIZE: Joi.number().min(1).default(10),

  // Security & JWT
  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .description('Secret key for signing JWT tokens (min 32 chars)'),
  JWT_EXPIRATION: Joi.string().default('1d'),
  INITIAL_BOOTSTRAP_TOKEN: Joi.string().allow('').optional(),

  // Tailscale
  TAILSCALE_SOCKET_PATH: Joi.string().default('/run/tailscale/tailscaled.sock'),
  TAILSCALE_AUTH_ENABLED: Joi.boolean().default(true),
  TAILSCALE_API_KEY: Joi.string().allow('').optional(),
  TAILNET_NAME: Joi.string().allow('').optional(),
  TRUSTED_PROXY_IPS: Joi.string().default('127.0.0.1/32,100.64.0.0/10'),

  // Kubernetes
  KUBERNETES_IN_CLUSTER: Joi.boolean().default(false),
  KUBECONFIG: Joi.string().allow('').optional(),
  KUBERNETES_NAMESPACE: Joi.string().default('minekubernetes'),
  KUBERNETES_NODE_AFFINITY_KEY: Joi.string().default('kubernetes.io/hostname'),
  KUBERNETES_NODE_AFFINITY_VALUE: Joi.string().allow('').optional(),

  // Images
  REGISTRY_URL: Joi.string().default('docker.io'),
  IMAGE_JVM_RUNNER: Joi.string().default('eclipse-temurin:21-jre-jammy'),
  IMAGE_INSTALLER_JOB: Joi.string().default('minekubernetes/installer:latest'),
  IMAGE_CONTROL_PLANE: Joi.string().default('minekubernetes/control-plane:latest'),
  IMAGE_GATEWAY: Joi.string().default('minekubernetes/gateway:latest'),

  // Storage
  SERVERS_DATA_ROOT: Joi.string().default('./storage/servers'),
  SHARED_CACHE_PATH: Joi.string().default('/cache'),
  BACKUPS_PATH: Joi.string().default('/backups'),

  // Observability & Telemetry
  LOG_LEVEL: Joi.string().default('context=*;level=info'),
  METRICS_ENABLED: Joi.boolean().default(true),
  METRICS_PORT: Joi.number().port().default(9090),
  METRICS_PATH: Joi.string().default('/metrics'),
}).unknown(true);
