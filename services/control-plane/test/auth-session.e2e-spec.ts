import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';

import { AppConfigService } from '../src/config/app-config.service';
import { User } from '../src/database/entities/user.entity';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { AuthController } from '../src/auth/auth.controller';
import { AuthGuard } from '../src/auth/auth.guard';
import { AuthService } from '../src/auth/auth.service';
import { JwtService } from '../src/auth/jwt.service';
import { RolesGuard } from '../src/auth/roles.guard';
import { TrustedProxyService } from '../src/auth/trusted-proxy.service';
import { TailscaleLocalDriver } from '../src/tailscale/drivers/tailscale-local.driver';

/**
 * #91 over real HTTP (real Nest app, real guards and pipes; only the user table and the Tailscale
 * LocalAPI are faked). supertest always connects from loopback, so "on the tailnet" is modeled by
 * what the fake WhoIs knows: the address a request is attributed to.
 */
describe('Panel session over HTTP (#91)', () => {
  const ADMIN_TS_ID = '4242';
  const VPN_ADDRESS = '100.101.102.103';
  const TAGGED_NODE_ADDRESS = '100.101.102.200';
  const admin = {
    id: 'u-admin',
    minecraft_nick: 'AdminSteve',
    role: 'ADMIN',
    tailscale_user_id: ADMIN_TS_ID,
  } as User;

  let app: INestApplication;
  let whoIs: jest.Mock;
  /** The address the fake tailnet recognizes as the admin's device. */
  let currentVpnPeer: string;

  async function start(trustedProxyIps: string[]) {
    whoIs = jest.fn(async (ip: string) => {
      if (ip === currentVpnPeer) {
        return { userId: ADMIN_TS_ID, isOwner: true, tags: [] };
      }
      // Tagged nodes all report the same "tagged-devices" owner; here it is (wrongly) linked to the admin.
      if (ip === TAGGED_NODE_ADDRESS) {
        return { userId: ADMIN_TS_ID, isOwner: false, tags: ['tag:server'] };
      }
      return null;
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtService,
        TrustedProxyService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        {
          provide: getRepositoryToken(User),
          useValue: {
            count: async () => 1,
            findOne: async ({ where }: any) =>
              [admin].find((u) =>
                Object.entries(where).every(([key, value]) => (u as any)[key] === value),
              ) ?? null,
          },
        },
        {
          provide: AppConfigService,
          useValue: {
            jwt: { secret: 'e2e_secret_that_is_at_least_32_characters_long' },
            authTrustedProxyIps: trustedProxyIps,
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
  }

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/auth/token (removed)', () => {
    beforeEach(async () => {
      currentVpnPeer = VPN_ADDRESS;
      await start([]);
    });

    it('does not hand out a token for a known nickname', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/token')
        .send({ minecraft_nick: admin.minecraft_nick });

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('access_token');
    });

    it('does not turn a nickname sent to the session endpoint into an identity either', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/session')
        .send({ minecraft_nick: admin.minecraft_nick });

      expect(res.status).toBe(401);
      expect(res.body.access_token).toBeUndefined();
    });
  });

  describe('forged x-tailscale-user from outside the tailnet', () => {
    beforeEach(async () => {
      currentVpnPeer = VPN_ADDRESS;
      await start([]);
    });

    it('is answered with 401 on a guarded route', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('x-tailscale-user', ADMIN_TS_ID);

      expect(res.status).toBe(401);
    });

    it('does not open a session, and the forged X-Forwarded-For is not what WhoIs is asked about', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/session')
        .set('x-forwarded-for', VPN_ADDRESS)
        .set('x-tailscale-user', ADMIN_TS_ID);

      expect(res.status).toBe(401);
      expect(whoIs).toHaveBeenCalledWith('127.0.0.1');
      expect(whoIs).not.toHaveBeenCalledWith(VPN_ADDRESS);
    });
  });

  describe('admin on the VPN', () => {
    it('signs in with no body at all and the JWT works on guarded routes', async () => {
      currentVpnPeer = '127.0.0.1';
      await start([]);

      const session = await request(app.getHttpServer()).post('/api/auth/session').send();

      expect(session.status).toBe(200);
      expect(session.body.user).toMatchObject({ id: 'u-admin', role: 'ADMIN' });

      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${session.body.access_token}`);
      expect(me.status).toBe(200);
      expect(me.body.minecraft_nick).toBe('AdminSteve');
    });

    it('signs in through a trusted proxy, which reports the real client in X-Forwarded-For', async () => {
      currentVpnPeer = VPN_ADDRESS;
      await start(['127.0.0.1']);

      const session = await request(app.getHttpServer())
        .post('/api/auth/session')
        .set('x-forwarded-for', VPN_ADDRESS);

      expect(session.status).toBe(200);
      expect(whoIs).toHaveBeenCalledWith(VPN_ADDRESS);
    });

    it('a tagged device gets 401 and no token, even with its owner id linked to the admin (#136)', async () => {
      currentVpnPeer = VPN_ADDRESS;
      await start(['127.0.0.1']);

      const res = await request(app.getHttpServer())
        .post('/api/auth/session')
        .set('x-forwarded-for', TAGGED_NODE_ADDRESS);

      expect(whoIs).toHaveBeenCalledWith(TAGGED_NODE_ADDRESS);
      expect(res.status).toBe(401);
      expect(JSON.stringify(res.body)).toContain('Tagged devices cannot open a panel session');
      expect(res.body.access_token).toBeUndefined();
    });

    it('accepts x-tailscale-user from a trusted proxy', async () => {
      currentVpnPeer = VPN_ADDRESS;
      await start(['127.0.0.1']);

      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('x-tailscale-user', ADMIN_TS_ID);

      expect(res.status).toBe(200);
    });
  });
});
