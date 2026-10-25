import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { AppConfigService } from '../src/config/app-config.service';
import { User } from '../src/database/entities/user.entity';
import { AuthGuard } from '../src/auth/auth.guard';
import { AuthService } from '../src/auth/auth.service';
import { JwtService } from '../src/auth/jwt.service';
import { RolesGuard } from '../src/auth/roles.guard';
import { TrustedProxyService } from '../src/auth/trusted-proxy.service';
import { ServersController } from '../src/servers/servers.controller';
import { ServersService } from '../src/servers/servers.service';
import { ServersFilesService } from '../src/servers/servers-files.service';
import { ServersBackupService } from '../src/servers/servers-backup.service';
import { MinecraftVersionsController } from '../src/servers/minecraft-versions.controller';
import { MinecraftVersionsService } from '../src/servers/minecraft-versions.service';
import { AdminController } from '../src/admin/admin.controller';
import { MeController } from '../src/admin/me.controller';
import { AdminService } from '../src/admin/admin.service';
import { SettingsController } from '../src/settings/settings.controller';
import { SettingsService } from '../src/settings/settings.service';
import { TailscaleController } from '../src/tailscale/tailscale.controller';
import { TailscalePostureService } from '../src/tailscale/posture/tailscale-posture.service';
import { InvitesService } from '../src/tailscale/invites/invites.service';
import { DevicesService } from '../src/tailscale/devices/devices.service';
import { SharesController } from '../src/tailscale/shares/shares.controller';
import { SharesService } from '../src/tailscale/shares/shares.service';

describe('Player Role Access & MeController E2E (#216)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let playerToken: string;

  const playerUser: User = {
    id: 'u-player-test',
    minecraft_nick: 'PlayerSteve',
    role: 'PLAYER',
    tailscale_user_id: '12345',
  } as User;

  beforeAll(async () => {
    const appConfig = new AppConfigService(
      new ConfigService({ JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long-123456' }),
    );
    jwtService = new JwtService(appConfig);
    playerToken = jwtService.sign({
      sub: playerUser.id,
      nick: playerUser.minecraft_nick,
      role: playerUser.role,
    });

    const mockAuthService = {
      validateUserById: jest.fn(async (id: string) => {
        if (id === playerUser.id) return playerUser;
        return null;
      }),
      validateTailscaleUser: jest.fn(async () => null),
    };

    const mockAdminService = {
      listUsers: jest.fn(async () => []),
      getAccessMatrix: jest.fn(async () => ({ users: [], servers: [], cells: {} })),
      simulateAccessChanges: jest.fn(async () => []),
      probeIdentity: jest.fn(async () => ({})),
      listMyServers: jest.fn(async (user: User) => {
        if (user.id !== playerUser.id) return [];
        return [
          {
            name: 'Survival World',
            address: 'survival.mc.example.com',
            state: 'READY',
            playersOnline: 4,
            icon: 'data:image/png;base64,abc123',
          },
          {
            name: 'Creative Sandbox',
            address: 'creative.mc.example.com',
            state: 'MAINTENANCE',
            playersOnline: 0,
            icon: null,
          },
        ];
      }),
    };

    const mockInvitesService = {
      validateToken: jest.fn(async (token: string) => ({
        id: 'inv-1',
        token,
        tailnet_name: 'test.tailnet',
      })),
      claimInvite: jest.fn(async () => ({ success: true })),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        ServersController,
        MinecraftVersionsController,
        AdminController,
        MeController,
        SettingsController,
        TailscaleController,
        SharesController,
      ],
      providers: [
        { provide: AppConfigService, useValue: appConfig },
        { provide: JwtService, useValue: jwtService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: TrustedProxyService, useValue: { isTrusted: () => false } },
        { provide: AdminService, useValue: mockAdminService },
        { provide: ServersService, useValue: { list: async () => [] } },
        { provide: ServersFilesService, useValue: {} },
        { provide: ServersBackupService, useValue: {} },
        { provide: MinecraftVersionsService, useValue: { listVersions: async () => [] } },
        { provide: SettingsService, useValue: { getAll: async () => [] } },
        { provide: TailscalePostureService, useValue: { getLatestAuditReport: async () => ({}) } },
        { provide: InvitesService, useValue: mockInvitesService },
        { provide: DevicesService, useValue: { listDevices: async () => [] } },
        { provide: SharesService, useValue: { listShares: async () => [] } },
        { provide: APP_GUARD, useClass: AuthGuard },
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
    await app.close();
  });

  describe('Admin-only routes reject PLAYER users with HTTP 403', () => {
    const adminRoutes = [
      { method: 'get', path: '/api/servers' },
      { method: 'get', path: '/api/servers/versions' },
      { method: 'get', path: '/api/admin/users' },
      { method: 'get', path: '/api/admin/access/matrix' },
      { method: 'post', path: '/api/admin/access/simulate', body: {} },
      { method: 'post', path: '/api/admin/access/identity-probe', body: { ip: '100.1.2.3' } },
      { method: 'get', path: '/api/settings' },
      { method: 'get', path: '/api/tailscale/posture-audit' },
      { method: 'get', path: '/api/tailscale/devices' },
      { method: 'get', path: '/api/tailscale/shares/unlinked-attempts' },
    ];

    for (const route of adminRoutes) {
      it(`${route.method.toUpperCase()} ${route.path} responds with 403 Forbidden`, async () => {
        const req = (request(app.getHttpServer()) as any)
          [route.method](route.path)
          .set('Authorization', `Bearer ${playerToken}`);

        if (route.body) {
          req.send(route.body);
        }

        const res = await req;
        expect(res.status).toBe(403);
      });
    }
  });

  describe('Public invite routes remain accessible without ADMIN role', () => {
    it('GET /api/tailscale/invites/validate/:token does not return 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tailscale/invites/validate/test-token')
        .set('Authorization', `Bearer ${playerToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: 'inv-1',
        token: 'test-token',
        tailnet_name: 'test.tailnet',
      });
    });

    it('POST /api/tailscale/claim does not return 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tailscale/claim')
        .set('Authorization', `Bearer ${playerToken}`)
        .send({
          token: '1234567890abcdef1234567890abcdef',
          realName: 'Steve Real',
          minecraftNick: 'SteveCraft',
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });
  });

  describe('GET /api/me/servers for PLAYER role', () => {
    it('responds with 200, only granted worlds, maintenance status, and no internal IDs', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/me/servers')
        .set('Authorization', `Bearer ${playerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);

      const [readyServer, maintenanceServer] = res.body;

      // 1. Ready server
      expect(readyServer.name).toBe('Survival World');
      expect(readyServer.address).toBe('survival.mc.example.com');
      expect(readyServer.state).toBe('READY');
      expect(readyServer.playersOnline).toBe(4);
      expect(readyServer.icon).toBe('data:image/png;base64,abc123');
      expect(readyServer.id).toBeUndefined();
      expect(readyServer.resource_name).toBeUndefined();

      // 2. Maintenance server
      expect(maintenanceServer.name).toBe('Creative Sandbox');
      expect(maintenanceServer.address).toBe('creative.mc.example.com');
      expect(maintenanceServer.state).toBe('MAINTENANCE');
      expect(maintenanceServer.playersOnline).toBe(0);
      expect(maintenanceServer.id).toBeUndefined();
      expect(maintenanceServer.resource_name).toBeUndefined();
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/me/servers');
      expect(res.status).toBe(401);
    });
  });
});
