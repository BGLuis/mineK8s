import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { RolesGuard } from '../src/auth/roles.guard';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { AppConfigService } from '../src/config/app-config.service';
import { InvitesService } from '../src/tailscale/invites/invites.service';
import { TailscaleController } from '../src/tailscale/tailscale.controller';
import { DevicesService } from '../src/tailscale/devices/devices.service';
import { TailscalePostureService } from '../src/tailscale/posture/tailscale-posture.service';
import { SettingsController } from '../src/settings/settings.controller';
import { SettingsService } from '../src/settings/settings.service';

const FAKE_API_KEY = 'tskey-api-FAKE-0000000000';

/** Stands in for the JWT guard: the role comes from a header so each test picks who is calling. */
@Injectable()
class HeaderAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = req.headers['x-test-role'];
    if (role) {
      req.user = { id: 'u1', minecraft_nick: 'AdminSteve', role };
    }
    return true;
  }
}

/** The settings page and the disabled invite flow over real HTTP: real guards, pipe, filter and error codes. */
describe('Settings over HTTP', () => {
  let app: INestApplication;
  const rows = new Map<string, any>();

  beforeAll(async () => {
    const appConfig = new AppConfigService(
      new ConfigService({ JWT_SECRET: 'a-jwt-secret-with-at-least-thirty-two-chars' }),
    );
    const repo = {
      find: async () => [...rows.values()],
      create: (row: any) => ({ ...row }),
      save: async (row: any) => {
        const saved = { ...row, updated_at: new Date() };
        rows.set(row.key, saved);
        return saved;
      },
      delete: async ({ key }: { key: string }) => rows.delete(key),
    };
    const settings = new SettingsService(repo as any, appConfig);
    // The real InvitesService, without the repositories the disabled flow never reaches.
    const invites = Object.create(InvitesService.prototype);
    Object.assign(invites, { appConfig });

    const moduleRef = await Test.createTestingModule({
      controllers: [SettingsController, TailscaleController],
      providers: [
        { provide: SettingsService, useValue: settings },
        { provide: InvitesService, useValue: invites },
        { provide: TailscalePostureService, useValue: {} },
        { provide: DevicesService, useValue: {} },
        { provide: APP_GUARD, useClass: HeaderAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const admin = (req: request.Test) => req.set('x-test-role', 'ADMIN');

  describe('/api/settings', () => {
    it('is closed to everyone but admins', async () => {
      await request(app.getHttpServer()).get('/api/settings').expect(403);
      await request(app.getHttpServer())
        .get('/api/settings')
        .set('x-test-role', 'PLAYER')
        .expect(403);
      await request(app.getHttpServer())
        .patch('/api/settings')
        .set('x-test-role', 'PLAYER')
        .send({ values: { 'healthBot.enabled': false } })
        .expect(403);
    });

    it('saves a secret, reports only that it is set, and never echoes it', async () => {
      const patch = await admin(request(app.getHttpServer()).patch('/api/settings'))
        .send({ values: { 'tailscale.apiKey': FAKE_API_KEY } })
        .expect(200);
      const read = await admin(request(app.getHttpServer()).get('/api/settings')).expect(200);

      for (const response of [patch, read]) {
        expect(response.text).not.toContain(FAKE_API_KEY);
        const view = response.body.sections
          .flatMap((s: any) => s.settings)
          .find((s: any) => s.key === 'tailscale.apiKey');
        expect(view).toMatchObject({ isSet: true, source: 'database', updatedBy: 'AdminSteve' });
      }
      expect(rows.get('tailscale.apiKey').value).not.toContain(FAKE_API_KEY);
    });

    it('answers an invalid value with 400 and the reasons in Portuguese', async () => {
      const res = await admin(request(app.getHttpServer()).patch('/api/settings'))
        .send({ values: { 'access.publicUrl': 'not a url', 'healthBot.intervalMs': 3 } })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details).toHaveLength(2);
      expect(res.body.message).toContain('URL pública do painel');
    });

    it('rejects a body without values', async () => {
      await admin(request(app.getHttpServer()).patch('/api/settings'))
        .send({ 'healthBot.enabled': false })
        .expect(400);
    });
  });

  describe('invite with an access key, disabled by default', () => {
    const disabled = (res: request.Response) => {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INVITE_KEY_DISABLED');
      expect(res.body.message).toContain('desativados');
    };

    it('refuses to resolve a link on /join', async () => {
      disabled(
        await request(app.getHttpServer()).get('/api/tailscale/invites/validate/some-token'),
      );
    });

    it('refuses to claim', async () => {
      disabled(
        await request(app.getHttpServer())
          .post('/api/tailscale/claim')
          .send({ token: 'a'.repeat(32), realName: 'Lucas Henrique', minecraftNick: 'LucasCraft' }),
      );
    });

    it('refuses to create an invite, even for an admin', async () => {
      disabled(
        await admin(request(app.getHttpServer()).post('/api/tailscale/invites')).send({
          name: 'Turma do Discord',
        }),
      );
    });
  });
});
