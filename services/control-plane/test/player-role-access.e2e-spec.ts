import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { AppConfigService } from '../src/config/app-config.service';
import { ModpackTaskEntity } from '../src/database/entities/modpack-task.entity';
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
import { TasksController } from '../src/tasks/tasks.controller';
import { ReconcilerController } from '../src/reconciler/reconciler.controller';
import { ReconcilerService } from '../src/reconciler/reconciler.service';
import { NodeController } from '../src/node/node.controller';
import { NodeMetricsService } from '../src/node/node-metrics.service';
import { HealthBotController } from '../src/probes/health-bot.controller';
import { HealthBotSchedulerService } from '../src/probes/health-bot-scheduler.service';
import { ModpacksController } from '../src/modpacks/modpacks.controller';
import { ModpackInstallerService } from '../src/modpacks/modpack-installer.service';
import { ModpackCatalogService } from '../src/modpacks/modpack-catalog.service';
import { ServerStatsController } from '../src/stats/server-stats.controller';
import { LagSnapshotService } from '../src/stats/lag-snapshot.service';
import { ServerStatsService } from '../src/stats/server-stats.service';

describe('Player Role Access & MeController E2E (#216)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let playerToken: string;
  let adminToken: string;

  const playerUser: User = {
    id: 'u-player-test',
    minecraft_nick: 'PlayerSteve',
    role: 'PLAYER',
    tailscale_user_id: '12345',
  } as User;

  const adminUser: User = {
    id: 'u-admin-test',
    minecraft_nick: 'AdminAlex',
    role: 'ADMIN',
    tailscale_user_id: '99999',
  } as User;

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
    adminToken = jwtService.sign({
      sub: adminUser.id,
      nick: adminUser.minecraft_nick,
      role: adminUser.role,
    });

    const mockAuthService = {
      validateUserById: jest.fn(async (id: string) => {
        if (id === playerUser.id) return playerUser;
        if (id === adminUser.id) return adminUser;
        return null;
      }),
      validateTailscaleUser: jest.fn(async () => null),
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
        TasksController,
        ReconcilerController,
        NodeController,
        HealthBotController,
        ModpacksController,
        ServerStatsController,
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
        { provide: getRepositoryToken(ModpackTaskEntity), useValue: { findOne: jest.fn() } },
        {
          provide: ReconcilerService,
          useValue: { reconcile: jest.fn(), getLastSummary: jest.fn() },
        },
        { provide: NodeMetricsService, useValue: { getMetrics: jest.fn() } },
        {
          provide: HealthBotSchedulerService,
          useValue: { getOverview: jest.fn(), getReports: jest.fn() },
        },
        { provide: ModpackInstallerService, useValue: {} },
        { provide: ModpackCatalogService, useValue: {} },
        { provide: ServerStatsService, useValue: { getStats: jest.fn() } },
        { provide: LagSnapshotService, useValue: { take: jest.fn() } },
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
    function extractRoutes(stack: any[]): Array<{ method: string; path: string }> {
      const routes: Array<{ method: string; path: string }> = [];
      for (const layer of stack) {
        if (layer.route) {
          const path: string = layer.route.path;
          for (const method of Object.keys(layer.route.methods)) {
            routes.push({ method, path });
          }
        } else if (layer.name === 'router' && layer.handle?.stack) {
          routes.push(...extractRoutes(layer.handle.stack));
        }
      }
      return routes;
    }

    const isExcluded = (path: string) => {
      return (
        path.startsWith('/api/auth') ||
        path.startsWith('/api/me') ||
        path.includes('validate') ||
        path.includes('claim')
      );
    };

    it('all admin routes discovered dynamically from the Express router return 403 Forbidden for PLAYER', async () => {
      const expressInstance = app.getHttpAdapter().getInstance();
      const stack = expressInstance.router?.stack || expressInstance._router?.stack || [];
      const allRoutes = extractRoutes(stack);
      const adminRoutes = allRoutes.filter((r) => !isExcluded(r.path));

      // Garante que descobriu as dezenas de rotas administrativas dos controladores montados
      expect(adminRoutes.length).toBeGreaterThan(40);

      for (const route of adminRoutes) {
        const concretePath = route.path.replace(
          /:[a-zA-Z0-9_]+/g,
          '11111111-1111-1111-1111-111111111111',
        );
        const req = (request(app.getHttpServer()) as any)
          [route.method](concretePath)
          .set('Authorization', `Bearer ${playerToken}`);

        const res = await req;
        expect(res.status).toBe(403);
      }
    });
  });

  describe('ADMIN access to /api/admin/access/simulate with ValidationPipe (#213)', () => {
    it('accepts valid changes and responds with 200', async () => {
      mockAdminService.simulateAccessChanges.mockResolvedValueOnce([]);

      const res = await request(app.getHttpServer())
        .post('/api/admin/access/simulate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          changes: [
            {
              type: 'deleteGroup',
              groupId: '123e4567-e89b-12d3-a456-426614174000',
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(mockAdminService.simulateAccessChanges).toHaveBeenCalledWith({
        changes: [
          {
            type: 'deleteGroup',
            groupId: '123e4567-e89b-12d3-a456-426614174000',
          },
        ],
      });
    });

    it('rejects invalid changes with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/access/simulate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          changes: [
            {
              type: 'notAValidChangeType',
            },
          ],
        });

      expect(res.status).toBe(400);
    });
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
      expect(maintenanceServer.icon).toBeNull();
      expect(maintenanceServer.id).toBeUndefined();
      expect(maintenanceServer.resource_name).toBeUndefined();
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/me/servers');
      expect(res.status).toBe(401);
    });
  });
});
