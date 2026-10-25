import { TrustedProxyService } from '../auth/trusted-proxy.service';
import { TasksGateway } from './tasks.gateway';

const TASK_ID = '3f2b8c1e-5a47-4d0e-9c1b-7a6e2d4f8b90';

describe('TasksGateway (RF-STO-18, #92)', () => {
  const admin = { id: 'u-admin', role: 'ADMIN' };
  const player = { id: 'u-player', role: 'PLAYER' };
  const stranger = { id: 'u-stranger', role: 'PLAYER' };

  let gateway: TasksGateway;
  let mockServer: any;
  let taskRepo: { findOne: jest.Mock };
  let accessRepo: { findOne: jest.Mock };
  let authService: any;
  let jwtService: any;

  const socket = (auth: object = {}, extra: object = {}): any => ({
    id: 'client-1',
    handshake: { auth, headers: {}, query: {}, ...extra },
    data: {},
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  });

  beforeEach(() => {
    taskRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        where.id === TASK_ID ? { id: TASK_ID, serverId: 'srv-1' } : null,
      ),
    };
    accessRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        where.user_id === player.id && where.server_id === 'srv-1' ? { ...where } : null,
      ),
    };
    authService = {
      validateUserById: jest.fn(
        async (id: string) => [admin, player, stranger].find((user) => user.id === id) ?? null,
      ),
      validateTailscaleUser: jest.fn(async () => admin),
    };
    jwtService = {
      verify: jest.fn((token: string) =>
        token.startsWith('jwt-') ? { sub: token.slice(4) } : null,
      ),
    };

    gateway = new TasksGateway(
      taskRepo as any,
      authService,
      jwtService,
      new TrustedProxyService({ authTrustedProxyIps: ['10.0.0.5'] } as any),
    );
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
    gateway.server = mockServer;
  });

  describe('handshake', () => {
    it('keeps a client with a valid token connected and remembers who it is', async () => {
      const client = socket({ token: 'jwt-u-admin' });

      await gateway.handleConnection(client);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.user).toBe(admin);
    });

    it.each([
      ['without a token', {}],
      ['with an invalid token', { token: 'garbage' }],
      ['with a token of a user that no longer exists', { token: 'jwt-u-gone' }],
    ])('emits unauthorized and disconnects a client %s', async (_label, auth) => {
      const client = socket(auth);

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('unauthorized', expect.any(Object));
      expect(client.disconnect).toHaveBeenCalled();
      expect(client.data.user).toBeUndefined();
    });

    it('rejects a forged x-tailscale-user header from outside the trusted proxies', async () => {
      const client = socket(
        {},
        { address: '203.0.113.9', headers: { 'x-tailscale-user': 'admin' } },
      );

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('accepts x-tailscale-user from a trusted proxy', async () => {
      const client = socket({}, { address: '10.0.0.5', headers: { 'x-tailscale-user': 'admin' } });

      await gateway.handleConnection(client);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.user).toBe(admin);
    });
  });

  describe('subscribeToTask', () => {
    const connected = async (user: object) => {
      const client = socket({ token: `jwt-${(user as any).id}` });
      await gateway.handleConnection(client);
      return client;
    };

    it('joins an administrator to the room of the task', async () => {
      const client = await connected(admin);

      const res = await gateway.handleSubscribeToTask(client, { taskId: TASK_ID });

      expect(client.join).toHaveBeenCalledWith(`task:${TASK_ID}`);
      expect(res).toEqual({ status: 'subscribed', taskId: TASK_ID });
    });

    it('refuses a PLAYER user even if granted access to the server the task belongs to (#209)', async () => {
      const client = await connected(player);

      const res = await gateway.handleSubscribeToTask(client, { taskId: TASK_ID });

      expect(client.join).not.toHaveBeenCalled();
      expect(res).toEqual({ status: 'error', message: `Task "${TASK_ID}" not found` });
    });

    it('refuses a user without access to that server, answering like for a task that does not exist', async () => {
      const client = await connected(stranger);

      const missingId = '00000000-0000-4000-8000-000000000000';

      const denied = await gateway.handleSubscribeToTask(client, { taskId: TASK_ID });
      const missing = await gateway.handleSubscribeToTask(client, { taskId: missingId });

      expect(client.join).not.toHaveBeenCalled();
      expect(denied).toEqual({ status: 'error', message: `Task "${TASK_ID}" not found` });
      expect(missing).toEqual({ status: 'error', message: `Task "${missingId}" not found` });
    });

    it('refuses a socket that never completed the handshake', async () => {
      const client = socket();

      const res = await gateway.handleSubscribeToTask(client, { taskId: TASK_ID });

      expect(client.join).not.toHaveBeenCalled();
      expect(res).toMatchObject({ status: 'error' });
    });

    it('does not query the database with an id that is not a uuid', async () => {
      const client = await connected(admin);

      const res = await gateway.handleSubscribeToTask(client, { taskId: "x' OR 1=1 --" });

      expect(taskRepo.findOne).not.toHaveBeenCalled();
      expect(res).toMatchObject({ status: 'error' });
    });

    it('requires a taskId', async () => {
      const client = await connected(admin);

      await expect(gateway.handleSubscribeToTask(client, {} as any)).resolves.toEqual({
        status: 'error',
        message: 'taskId is required',
      });
    });
  });

  it('emits taskProgress to the room of the task', () => {
    const payload = {
      taskId: 'task-uuid-1',
      serverId: 'srv-1',
      status: 'DOWNLOADING',
      progressPercent: 50,
      downloadedFiles: 25,
      totalFiles: 50,
      currentStep: 'Baixando mod lithium.jar (via Cache CAS)',
    };

    gateway.emitTaskProgress(payload);

    expect(mockServer.to).toHaveBeenCalledWith('task:task-uuid-1');
    expect(mockServer.emit).toHaveBeenCalledWith('taskProgress', payload);
  });
});
