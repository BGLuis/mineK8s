import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { AppConfigService } from '@config/app-config.service';
import { AppSetting } from '@database/entities/app-setting.entity';
import {
  createIntegrationDataSource,
  describeWithDatabase,
} from '@database/testing/integration-datasource';

import { SettingsService } from './settings.service';

const FAKE_API_KEY = 'tskey-api-FAKE-0000000000';

/** The app_settings migration and the service against a real Postgres. */
describeWithDatabase('SettingsService contra Postgres real', () => {
  let ds: DataSource;

  const newService = () =>
    new SettingsService(
      ds.getRepository(AppSetting),
      new AppConfigService(
        new ConfigService({ JWT_SECRET: 'a-jwt-secret-with-at-least-thirty-two-chars' }),
      ),
    );

  beforeAll(async () => {
    ds = await createIntegrationDataSource('int_settings');
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('keeps values across restarts, with secrets encrypted in the column', async () => {
    const first = newService();
    await first.update(
      { 'tailscale.apiKey': FAKE_API_KEY, 'access.publicUrl': 'https://painel.mine.internal' },
      'AdminSteve',
    );

    const [raw] = await ds.query(`SELECT * FROM app_settings WHERE key = 'tailscale.apiKey'`);
    expect(raw.is_secret).toBe(true);
    expect(raw.value).not.toContain(FAKE_API_KEY);
    expect(raw.updated_by).toBe('AdminSteve');

    const restarted = newService();
    await restarted.onModuleInit();
    expect(restarted.getString('tailscale.apiKey')).toBe(FAKE_API_KEY);
    expect(restarted.getString('access.publicUrl')).toBe('https://painel.mine.internal');
  });

  it('removes the row when a setting goes back to the environment', async () => {
    const service = newService();
    await service.update({ 'healthBot.timeoutMs': 8000 }, null);
    await service.update({ 'healthBot.timeoutMs': null }, null);

    const rows = await ds.query(`SELECT * FROM app_settings WHERE key = 'healthBot.timeoutMs'`);
    expect(rows).toHaveLength(0);
  });
});
