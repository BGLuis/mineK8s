import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';

import { AuthGuard } from '../src/auth/auth.guard';
import { AuthService } from '../src/auth/auth.service';
import { JwtService } from '../src/auth/jwt.service';
import { TrustedProxyService } from '../src/auth/trusted-proxy.service';
import { AppConfigService } from '../src/config/app-config.service';
import { AllowedOriginsIoAdapter } from '../src/common/allowed-origins.io-adapter';
import { CONSOLE_DRIVER_TOKEN } from '../src/console/console-driver.interface';
import { ModpackTaskEntity } from '../src/database/entities/modpack-task.entity';
import { Server } from '../src/database/entities/server.entity';
import { ServerAuditLog } from '../src/database/entities/server-audit-log.entity';
import { UserServerAccess } from '../src/database/entities/user-server-access.entity';
import { K8sLogStreamerService } from '../src/logging/k8s-log-streamer.service';
import { ServersStateGateway } from '../src/server-events/servers-state.gateway';
import { TasksGateway } from '../src/tasks/tasks.gateway';
import { TerminalGateway } from '../src/terminal/terminal.gateway';

const PANEL_ORIGIN = 'http://localhost:4200';
const TASK_ID = '3f2b8c1e-5a47-4d0e-9c1b-7a6e2d4f8b90';
const SOCKET_IO = '/socket.io/?EIO=4&transport=polling';

/**
 * #92 over the real Socket.IO protocol (HTTP long-polling), against the real gateways and the
 * adapter main.ts installs. Only repositories and drivers are faked.
 */
describe('Socket.IO namespaces: origin and handshake authentication (#92)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const repo = { findOne: async () => null };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TasksGateway,
        TerminalGateway,
        ServersStateGateway,
        TrustedProxyService,
        // app.module installs it globally, so it also runs on every gateway message.
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: AuthService,
          useValue: {
            validateUserById: async (id: string) => (id === 'u-admin' ? { id, role: 'ADMIN' } : null),
            validateTailscaleUser: async () => null,
          },
        },
        { provide: JwtService, useValue: { verify: (token: string) => (token === 'admin-jwt' ? { sub: 'u-admin' } : null) } },
        { provide: AppConfigService, useValue: { authTrustedProxyIps: [] } },
        {
          provide: getRepositoryToken(ModpackTaskEntity),
          useValue: { findOne: async () => ({ id: TASK_ID, serverId: 'srv-1' }) },
        },
        { provide: getRepositoryToken(UserServerAccess), useValue: repo },
        { provide: getRepositoryToken(Server), useValue: repo },
        { provide: getRepositoryToken(ServerAuditLog), useValue: repo },
        { provide: CONSOLE_DRIVER_TOKEN, useValue: {} },
        { provide: K8sLogStreamerService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new AllowedOriginsIoAdapter(app, [PANEL_ORIGIN]));
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  const openSession = async (origin?: string) => {
    const req = request(baseUrl).get(SOCKET_IO);
    const res = await (origin ? req.set('Origin', origin) : req);
    return { res, sid: res.status === 200 ? JSON.parse(res.text.slice(1)).sid : undefined };
  };

  describe('origin', () => {
    it('refuses a foreign Origin at the handshake', async () => {
      const { res } = await openSession('https://evil.example');

      expect(res.status).toBe(403);
    });

    it('accepts the panel Origin and echoes it in CORS, not a wildcard', async () => {
      const { res } = await openSession(PANEL_ORIGIN);

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(PANEL_ORIGIN);
    });

    it('accepts clients that send no Origin, such as the CLI and the gateway', async () => {
      const { res } = await openSession();

      expect(res.status).toBe(200);
    });
  });

  describe('namespace connection without credentials', () => {
    it.each(['/ws/tasks', '/terminal', '/ws/servers'])(
      '%s answers unauthorized and closes the connection',
      async (namespace) => {
        const { sid } = await openSession(PANEL_ORIGIN);
        const url = `${SOCKET_IO}&sid=${sid}`;

        await request(baseUrl)
          .post(url)
          .set('Origin', PANEL_ORIGIN)
          .set('Content-Type', 'text/plain')
          .send(`40${namespace},`)
          .expect(200);
        const packets = await request(baseUrl).get(url).set('Origin', PANEL_ORIGIN);

        expect(packets.text).toContain(`42${namespace},["unauthorized"`);
        expect(packets.text).toContain(`41${namespace},`);
      },
    );
  });

  describe('wizard flow: what the SPA does after creating a server', () => {
    it('delivers taskProgress to an authenticated client that subscribed to its task', async () => {
      const { sid } = await openSession(PANEL_ORIGIN);
      const url = `${SOCKET_IO}&sid=${sid}`;
      const send = (packet: string) =>
        request(baseUrl).post(url).set('Origin', PANEL_ORIGIN).set('Content-Type', 'text/plain').send(packet).expect(200);
      const poll = async () => (await request(baseUrl).get(url).set('Origin', PANEL_ORIGIN)).text;

      await send('40/ws/tasks,{"token":"admin-jwt"}');
      expect(await poll()).toContain('40/ws/tasks,{"sid"');

      await send(`42/ws/tasks,7["subscribeToTask",{"taskId":"${TASK_ID}"}]`);
      expect(await poll()).toContain(`43/ws/tasks,7[{"status":"subscribed","taskId":"${TASK_ID}"}]`);

      app.get(TasksGateway).emitTaskProgress({
        taskId: TASK_ID,
        serverId: 'srv-1',
        status: 'DOWNLOADING',
        progressPercent: 40,
        downloadedFiles: 4,
        totalFiles: 10,
        currentStep: 'Downloading mods',
      });
      expect(await poll()).toContain('42/ws/tasks,["taskProgress",{"taskId":"' + TASK_ID + '"');
    });
  });
});
