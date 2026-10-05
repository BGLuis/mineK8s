import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';

import { AuthController } from '../src/auth/auth.controller';
import { AuthGuard } from '../src/auth/auth.guard';
import { AuthService } from '../src/auth/auth.service';
import { JwtService } from '../src/auth/jwt.service';
import { RolesGuard } from '../src/auth/roles.guard';
import { TrustedProxyService } from '../src/auth/trusted-proxy.service';
import { AdminLinkService } from '../src/cli/admin-link.service';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { AppConfigService } from '../src/config/app-config.service';
import { User } from '../src/database/entities/user.entity';
import { TailscaleLocalDriver } from '../src/tailscale/drivers/tailscale-local.driver';

/**
 * #131: an admin created before #126 has no tailscale_user_id and is locked out of
 * POST /api/auth/session. The command and the login share one user table, so what the command
 * writes is what the login reads. supertest connects from loopback, so the fake WhoIs treats
 * 127.0.0.1 as the admin's tailnet device.
 */
describe('Linking a legacy admin, then signing in over HTTP (#131)', () => {
  const ADMIN_TS_ID = '4242';

  let app: INestApplication;
  let link: AdminLinkService;
  let users: User[];

  beforeEach(async () => {
    users = [
      {
        id: 'u-legacy',
        minecraft_nick: 'LegacyAdmin',
        role: 'ADMIN',
        tailscale_user_id: null,
      } as User,
    ];
    const matches = (where: Record<string, unknown>) => (u: User) =>
      Object.entries(where).every(([key, value]) => (u as any)[key] === value);
    const whoIs = jest.fn(async (ip: string) =>
      ip === '127.0.0.1' ? { userId: ADMIN_TS_ID, isOwner: true, tags: [] } : null,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        AdminLinkService,
        JwtService,
        TrustedProxyService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        {
          provide: getRepositoryToken(User),
          useValue: {
            count: async () => users.length,
            findOne: async ({ where }: any) => users.find(matches(where)) ?? null,
            find: async ({ where }: any) => users.filter(matches(where)),
            update: async ({ id }: { id: string }, patch: Partial<User>) => {
              Object.assign(users.find((u) => u.id === id) as User, patch);
            },
          },
        },
        {
          provide: AppConfigService,
          useValue: {
            jwt: { secret: 'e2e_secret_that_is_at_least_32_characters_long' },
            authTrustedProxyIps: [],
          },
        },
        { provide: TailscaleLocalDriver, useValue: { queryWhoIs: whoIs } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    link = app.get(AdminLinkService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('refuses the legacy admin before the link and opens a session after it', async () => {
    const before = await request(app.getHttpServer()).post('/api/auth/session');
    expect(before.status).toBe(401);

    await link.link({ nick: 'LegacyAdmin', ip: '127.0.0.1' });

    const after = await request(app.getHttpServer()).post('/api/auth/session');
    expect(after.status).toBe(200);
    expect(after.body.user).toMatchObject({ id: 'u-legacy', role: 'ADMIN' });

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${after.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.minecraft_nick).toBe('LegacyAdmin');
  });
});
