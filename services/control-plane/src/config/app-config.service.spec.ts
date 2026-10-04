import { ConfigService } from '@nestjs/config';

import { appConfigSchema } from './app-config.schema';
import { AppConfigService } from './app-config.service';

describe('AppConfigModule & Schema Validation', () => {
  it('should validate a valid environment configuration', () => {
    const validEnv = {
      NODE_ENV: 'development',
      PORT: 3000,
      DB_USER: 'minek8s',
      DB_PASSWORD: 'password123',
      DB_NAME: 'minekubernetes',
      JWT_SECRET: 'this_is_a_valid_jwt_secret_with_at_least_32_characters',
    };

    const { error, value } = appConfigSchema.validate(validEnv);
    expect(error).toBeUndefined();
    expect(value.PORT).toBe(3000);
    expect(value.DB_HOST).toBe('localhost');
    expect(value.DB_PORT).toBe(5432);
    expect(value.KUBERNETES_NAMESPACE).toBe('minekubernetes');
    expect(value.LOG_LEVEL).toBe('context=*;level=info');
  });

  it('should reject when required JWT_SECRET is too short (< 32 chars)', () => {
    const invalidEnv = {
      DB_USER: 'minek8s',
      DB_PASSWORD: 'password123',
      DB_NAME: 'minekubernetes',
      JWT_SECRET: 'too_short',
    };

    const { error } = appConfigSchema.validate(invalidEnv);
    expect(error).toBeDefined();
    expect(error?.message).toContain('JWT_SECRET');
  });

  it('should reject when DB credentials are missing', () => {
    const invalidEnv = {
      JWT_SECRET: 'this_is_a_valid_jwt_secret_with_at_least_32_characters',
    };

    const { error } = appConfigSchema.validate(invalidEnv, { abortEarly: false });
    expect(error).toBeDefined();
    expect(error?.message).toContain('DB_USER');
    expect(error?.message).toContain('DB_PASSWORD');
    expect(error?.message).toContain('DB_NAME');
  });

  it('should provide typed getters via AppConfigService', () => {
    const mockConfigService = new ConfigService({
      NODE_ENV: 'test',
      PORT: 3001,
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_USER: 'minek8s',
      DB_PASSWORD: 'secretpassword',
      DB_NAME: 'minekubernetes',
      JWT_SECRET: 'this_is_a_valid_jwt_secret_with_at_least_32_characters',
      JWT_EXPIRATION: '2d',
      TAILSCALE_SOCKET_PATH: '/run/tailscale.sock',
      TAILSCALE_AUTH_ENABLED: true,
      TRUSTED_PROXY_IPS: '127.0.0.1,100.64.0.1',
      KUBERNETES_NAMESPACE: 'minekubernetes',
    });

    const appConfig = new AppConfigService(mockConfigService);
    expect(appConfig.nodeEnv).toBe('test');
    expect(appConfig.isTest).toBe(true);
    expect(appConfig.port).toBe(3001);
    expect(appConfig.database.user).toBe('minek8s');
    expect(appConfig.database.port).toBe(5432);
    expect(appConfig.jwt.secret).toBe(
      'this_is_a_valid_jwt_secret_with_at_least_32_characters',
    );
    expect(appConfig.jwt.expiration).toBe('2d');
    expect(appConfig.tailscale.trustedProxyIps).toEqual([
      '127.0.0.1',
      '100.64.0.1',
    ]);
    expect(appConfig.kubernetes.namespace).toBe('minekubernetes');
  });

  it('should trust no proxy for identity headers unless AUTH_TRUSTED_PROXY_IPS is set', () => {
    const base = {
      DB_USER: 'minek8s',
      DB_PASSWORD: 'secretpassword',
      DB_NAME: 'minekubernetes',
      JWT_SECRET: 'this_is_a_valid_jwt_secret_with_at_least_32_characters',
    };

    const unset = appConfigSchema.validate(base).value;
    expect(new AppConfigService(new ConfigService(unset)).authTrustedProxyIps).toEqual([]);

    const configured = new AppConfigService(
      new ConfigService({ ...base, AUTH_TRUSTED_PROXY_IPS: '127.0.0.1, 10.0.0.0/24' }),
    );
    expect(configured.authTrustedProxyIps).toEqual(['127.0.0.1', '10.0.0.0/24']);
  });
});
