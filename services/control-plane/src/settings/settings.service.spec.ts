import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfigService } from '@config/app-config.service';
import { AppSetting } from '@database/entities/app-setting.entity';

import { SettingsService } from './settings.service';
import { SettingSectionView, SettingView } from './settings.types';

const JWT_SECRET = 'a-jwt-secret-with-at-least-thirty-two-chars';
const FAKE_API_KEY = 'tskey-api-FAKE-0000000000';
const FAKE_CF_TOKEN = 'cf-token-FAKE-0000000000';

const ENV_NAMES = [
  'TAILSCALE_API_KEY',
  'TAILNET_NAME',
  'TAILSCALE_TAILNET',
  'TAILSCALE_INVITE_KEY_ENABLED',
  'TAILSCALE_NODE_SHARING_ENABLED',
  'PUBLIC_BASE_URL',
  'APP_URL',
  'WORLDS_BASE_DOMAIN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ZONE_ID',
  'CLOUDFLARE_ROOT_DOMAIN',
  'HEALTH_BOT_ENABLED',
  'HEALTH_BOT_INTERVAL_MS',
  'HEALTH_BOT_TIMEOUT_MS',
];

function fakeRepo(rows: AppSetting[] = []) {
  const db = new Map(rows.map((row) => [row.key, row]));
  return {
    db,
    find: jest.fn(async () => [...db.values()]),
    create: jest.fn((row: Partial<AppSetting>) => ({ ...row }) as AppSetting),
    save: jest.fn(async (row: AppSetting) => {
      const saved = { ...row, updated_at: new Date('2026-10-01T12:00:00.000Z') };
      db.set(row.key, saved);
      return saved;
    }),
    delete: jest.fn(async ({ key }: { key: string }) => {
      db.delete(key);
    }),
  };
}

function build(rows: AppSetting[] = [], jwtSecret = JWT_SECRET) {
  const repo = fakeRepo(rows);
  const appConfig = new AppConfigService(
    new ConfigService({
      JWT_SECRET: jwtSecret,
      PORT: 8080,
      KUBERNETES_NAMESPACE: 'minekubernetes',
    }),
  );
  const service = new SettingsService(repo as any, appConfig);
  return { service, repo, appConfig };
}

function settingOf(sections: SettingSectionView[], key: string): SettingView {
  return sections.flatMap((section) => section.settings).find((setting) => setting.key === key)!;
}

describe('SettingsService', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of ENV_NAMES) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of ENV_NAMES) {
      if (savedEnv[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = savedEnv[name];
      }
    }
    jest.restoreAllMocks();
  });

  describe('precedence: database, then environment, then default', () => {
    it('uses the default when nothing is set', () => {
      const { service } = build();

      expect(service.getNumber('healthBot.intervalMs')).toBe(300_000);
      expect(settingOf(service.snapshot().sections, 'healthBot.intervalMs').source).toBe('default');
    });

    it('lets the environment beat the default', () => {
      process.env.HEALTH_BOT_INTERVAL_MS = '60000';
      const { service } = build();

      expect(service.getNumber('healthBot.intervalMs')).toBe(60_000);
      expect(settingOf(service.snapshot().sections, 'healthBot.intervalMs').source).toBe(
        'environment',
      );
    });

    it('lets the database beat the environment, and null hands control back to it', async () => {
      process.env.HEALTH_BOT_INTERVAL_MS = '60000';
      const { service, repo } = build();

      await service.update({ 'healthBot.intervalMs': 120_000 }, 'AdminSteve');
      expect(service.getNumber('healthBot.intervalMs')).toBe(120_000);
      const view = settingOf(service.snapshot().sections, 'healthBot.intervalMs');
      expect(view).toMatchObject({ source: 'database', value: 120_000, updatedBy: 'AdminSteve' });

      await service.update({ 'healthBot.intervalMs': null }, 'AdminSteve');
      expect(repo.delete).toHaveBeenCalledWith({ key: 'healthBot.intervalMs' });
      expect(service.getNumber('healthBot.intervalMs')).toBe(60_000);
    });

    it('ignores an invalid environment value instead of breaking the consumer', () => {
      process.env.HEALTH_BOT_INTERVAL_MS = 'soon';
      const { service } = build();

      expect(service.getNumber('healthBot.intervalMs')).toBe(300_000);
    });

    it('treats an empty variable as not set', () => {
      process.env.TAILSCALE_API_KEY = '';
      const { service } = build();

      expect(settingOf(service.snapshot().sections, 'tailscale.apiKey')).toMatchObject({
        source: 'default',
        isSet: false,
      });
    });

    it('serves values stored in the database after a restart', async () => {
      const { service } = build([
        {
          key: 'access.publicUrl',
          value: 'https://painel.mine.internal',
          is_secret: false,
          updated_by: 'AdminSteve',
          updated_at: new Date('2026-10-01T12:00:00.000Z'),
        },
      ]);

      await service.onModuleInit();

      expect(service.getString('access.publicUrl')).toBe('https://painel.mine.internal');
    });
  });

  describe('tailnet name (TAILNET_NAME vs TAILSCALE_TAILNET)', () => {
    it('defaults to the key default tailnet', () => {
      expect(build().service.getString('tailscale.tailnet')).toBe('-');
    });

    it('honors the name the posture service always read', () => {
      process.env.TAILNET_NAME = 'exemplo.ts.net';

      expect(build().service.getString('tailscale.tailnet')).toBe('exemplo.ts.net');
    });

    it('still honors the name the cloud driver used to read', () => {
      process.env.TAILSCALE_TAILNET = 'legado.ts.net';

      expect(build().service.getString('tailscale.tailnet')).toBe('legado.ts.net');
    });

    it('feeds both consumers the same value', async () => {
      const { service, appConfig } = build();

      await service.update({ 'tailscale.tailnet': 'exemplo.ts.net' }, null);

      expect(appConfig.tailscale.tailnetName).toBe('exemplo.ts.net');
    });
  });

  describe('secrets', () => {
    it('are never returned by the API, only whether they are set', async () => {
      const { service } = build();

      const snapshot = await service.update(
        { 'tailscale.apiKey': FAKE_API_KEY, 'cloudflare.apiToken': FAKE_CF_TOKEN },
        'AdminSteve',
      );

      const text = JSON.stringify(snapshot);
      expect(text).not.toContain(FAKE_API_KEY);
      expect(text).not.toContain(FAKE_CF_TOKEN);
      const view = settingOf(snapshot.sections, 'tailscale.apiKey');
      expect(view).toMatchObject({ isSet: true, source: 'database' });
      expect(view).not.toHaveProperty('value');
      expect(view).not.toHaveProperty('defaultValue');
    });

    it('do not leak from the environment either', () => {
      process.env.TAILSCALE_API_KEY = FAKE_API_KEY;
      const { service } = build();

      const snapshot = service.snapshot();

      expect(JSON.stringify(snapshot)).not.toContain(FAKE_API_KEY);
      expect(settingOf(snapshot.sections, 'tailscale.apiKey')).toMatchObject({
        isSet: true,
        source: 'environment',
      });
    });

    it('are encrypted at rest and readable again after a restart', async () => {
      const { service, repo } = build();
      await service.update({ 'tailscale.apiKey': FAKE_API_KEY }, 'AdminSteve');

      const row = repo.db.get('tailscale.apiKey')!;
      expect(row.is_secret).toBe(true);
      expect(row.value).not.toContain(FAKE_API_KEY);

      const restarted = build([row]);
      await restarted.service.onModuleInit();
      expect(restarted.appConfig.tailscale.apiKey).toBe(FAKE_API_KEY);
    });

    it('fall back to the environment when JWT_SECRET changed and they cannot be decrypted', async () => {
      const { service, repo } = build();
      await service.update({ 'tailscale.apiKey': FAKE_API_KEY }, null);
      process.env.TAILSCALE_API_KEY = 'tskey-api-FROM-ENV-0000';
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const rotated = build(
        [repo.db.get('tailscale.apiKey')!],
        'rotated-jwt-secret-with-thirty-two-chars',
      );
      await rotated.service.onModuleInit();

      expect(rotated.appConfig.tailscale.apiKey).toBe('tskey-api-FROM-ENV-0000');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('tailscale.apiKey'));
      expect(JSON.stringify(warn.mock.calls)).not.toContain(FAKE_API_KEY);
    });

    it('are not written to the logs when changed', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const { service } = build();

      await service.update({ 'tailscale.apiKey': FAKE_API_KEY }, 'AdminSteve');

      expect(log).toHaveBeenCalledWith(expect.stringContaining('tailscale.apiKey'));
      expect(JSON.stringify(log.mock.calls)).not.toContain(FAKE_API_KEY);
    });
  });

  describe('validation', () => {
    it('rejects the whole request, saving nothing, when one value is invalid', async () => {
      const { service, repo } = build();

      const error = await service
        .update({ 'access.publicUrl': 'https://ok.example', 'healthBot.intervalMs': 5 }, null)
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(error).toBeInstanceOf(BadRequestException);
      const messages = (error as BadRequestException).getResponse() as { message: string[] };
      expect(messages.message).toEqual([expect.stringContaining('Intervalo entre testes')]);
      expect(repo.save).not.toHaveBeenCalled();
      expect(service.getString('access.publicUrl')).toBe('http://localhost:3000');
    });

    it('rejects keys that are not settings', async () => {
      const { service, repo } = build();

      await expect(service.update({ 'jwt.secret': 'x'.repeat(40) }, null)).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('stores the normalized form', async () => {
      const { service } = build();

      await service.update({ 'access.publicUrl': ' https://Painel.Mine.Internal/ ' }, null);

      expect(service.getString('access.publicUrl')).toBe('https://painel.mine.internal');
    });
  });

  describe('consumers', () => {
    it('see a change at once through AppConfigService, with no restart', async () => {
      const { service, appConfig } = build();
      expect(appConfig.tailscale.inviteKeyEnabled).toBe(false);
      expect(appConfig.healthBot.enabled).toBe(true);

      await service.update(
        {
          'tailscale.inviteKeyEnabled': true,
          'healthBot.enabled': false,
          'access.worldsDomain': 'mine.internal',
          'cloudflare.zoneId': '023e105f4ecef8ad9ca31a8372d0c353',
        },
        null,
      );

      expect(appConfig.tailscale.inviteKeyEnabled).toBe(true);
      expect(appConfig.healthBot.enabled).toBe(false);
      expect(appConfig.access.worldsDomain).toBe('mine.internal');
      expect(appConfig.cloudflare.zoneId).toBe('023e105f4ecef8ad9ca31a8372d0c353');
    });

    it('notify listeners only when something was saved', async () => {
      const { service } = build();
      const listener = jest.fn();
      service.onChange(listener);

      await service.update({ 'healthBot.enabled': false }, null);
      await service.update({}, null);
      await expect(service.update({ 'healthBot.enabled': 'maybe' }, null)).rejects.toThrow();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('survive a listener that throws', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const { service } = build();
      service.onChange(() => {
        throw new Error('boom');
      });

      await expect(service.update({ 'healthBot.enabled': false }, null)).resolves.toBeDefined();
    });
  });

  describe('snapshot', () => {
    it('groups the settings by section and lists the restart-only diagnostics', () => {
      const { service } = build();

      const { sections, readOnly } = service.snapshot();

      expect(sections.map((section) => section.id)).toEqual([
        'tailscale',
        'access',
        'cloudflare',
        'healthBot',
      ]);
      expect(readOnly.map((item) => item.envName)).toEqual(
        expect.arrayContaining(['PORT', 'TRUSTED_PROXY_IPS']),
      );
      expect(readOnly.find((item) => item.key === 'port')?.value).toBe('8080');
    });

    it('invites with a key start disabled and node sharing enabled', () => {
      const { sections } = build().service.snapshot();

      expect(settingOf(sections, 'tailscale.inviteKeyEnabled')).toMatchObject({
        value: false,
        source: 'default',
      });
      expect(settingOf(sections, 'tailscale.nodeSharingEnabled')).toMatchObject({ value: true });
    });
  });
});
