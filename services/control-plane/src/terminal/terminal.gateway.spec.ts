import { WsException } from '@nestjs/websockets';
import { Server } from '../database/entities/server.entity';
import { ServerAuditLog } from '../database/entities/server-audit-log.entity';
import { User } from '../database/entities/user.entity';
import { UserServerAccess } from '../database/entities/user-server-access.entity';
import { ConsoleDriver } from '../console/console-driver.interface';
import { K8sLogStreamerService } from '../logging/k8s-log-streamer.service';
import { AuthService } from '../auth/auth.service';
import { JwtService } from '../auth/jwt.service';
import { TrustedProxyService } from '../auth/trusted-proxy.service';
import { TerminalGateway } from './terminal.gateway';

describe('TerminalGateway (RF-RCON-12, RF-RCON-13, RF-RCON-14, Guarda L-01)', () => {
  let gateway: TerminalGateway;
  let mockServerRepo: any;
  let mockAuditRepo: any;
  let mockAccessRepo: any;
  let mockConsoleDriver: any;
  let mockLogStreamer: any;
  let mockK8sService: any;
  let mockAuthService: any;
  let mockJwtService: any;
  let mockSocketServer: any;

  const testAdminUser: User = {
    id: 'user-admin-uuid',
    email: 'admin@minek8s.io',
    minecraft_nick: 'AdminSteve',
    role: 'ADMIN',
  } as any;

  const testPlayerUser: User = {
    id: 'user-player-uuid',
    email: 'player@minek8s.io',
    minecraft_nick: 'PlayerAlex',
    role: 'PLAYER',
  } as any;

  const testServer: Server = {
    id: 'server-uuid-1',
    name: 'Survival World',
    subdomain: 'endereco-novo',
    resource_name: 'survival',
    state: 'READY',
  } as any;

  beforeEach(() => {
    mockServerRepo = {
      findOne: jest.fn(async ({ where }: any) => {
        if (where.id === testServer.id) return testServer;
        return null;
      }),
    };

    mockAuditRepo = {
      save: jest.fn(async (entity) => entity),
      find: jest.fn(async () => []),
    };

    mockAccessRepo = {
      findOne: jest.fn(async ({ where }: any) => {
        if (where.user_id === testPlayerUser.id && where.server_id === testServer.id) {
          return { user_id: testPlayerUser.id, server_id: testServer.id };
        }
        return null;
      }),
    };

    mockConsoleDriver = {
      sendCommand: jest.fn(async (_server, cmd) => `Executed: ${cmd}`),
    };

    mockLogStreamer = {
      getBuffer: jest.fn().mockReturnValue({
        getHistory: jest
          .fn()
          .mockReturnValue([
            { id: '1', timestamp: '12:00:00', level: 'INFO', message: 'World loaded' },
          ]),
      }),
      subscribeToDeltas: jest.fn().mockReturnValue(() => {}),
      attachServerStream: jest.fn().mockResolvedValue({}),
    };

    mockK8sService = { streamServerLogs: jest.fn().mockResolvedValue(null) };

    mockAuthService = {
      validateUserById: jest.fn(async (id: string) => {
        if (id === testAdminUser.id) return testAdminUser;
        if (id === testPlayerUser.id) return testPlayerUser;
        return null;
      }),
      validateTailscaleUser: jest.fn(async (tailscaleId: string) => {
        if (tailscaleId === 'admin@tailscale') return testAdminUser;
        return null;
      }),
    };

    mockJwtService = {
      verify: jest.fn((token: string) => {
        if (token === 'valid-admin-jwt') return { sub: testAdminUser.id };
        if (token === 'valid-player-jwt') return { sub: testPlayerUser.id };
        return null;
      }),
    };

    gateway = new TerminalGateway(
      mockServerRepo,
      mockAuditRepo,
      mockConsoleDriver,
      mockLogStreamer,
      mockK8sService,
      mockAuthService,
      mockJwtService,
      new TrustedProxyService({ authTrustedProxyIps: ['10.0.0.5'] } as any),
    );

    mockSocketServer = {
      to: jest.fn().mockReturnValue({
        emit: jest.fn(),
      }),
    };
    gateway.server = mockSocketServer;
  });

  describe('Handshake & Authentication (RF-RCON-14, Guarda L-01)', () => {
    it('should authenticate client with valid Bearer token in handshake auth', async () => {
      const mockClient: any = {
        handshake: {
          auth: { token: 'valid-admin-jwt' },
        },
        data: {},
        disconnect: jest.fn(),
        emit: jest.fn(),
      };

      await gateway.handleConnection(mockClient);

      expect(mockClient.data.user).toBe(testAdminUser);
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });

    it('should authenticate client with x-tailscale-user header from a trusted proxy', async () => {
      const mockClient: any = {
        handshake: {
          address: '10.0.0.5',
          headers: { 'x-tailscale-user': 'admin@tailscale' },
        },
        data: {},
        disconnect: jest.fn(),
        emit: jest.fn(),
      };

      await gateway.handleConnection(mockClient);

      expect(mockClient.data.user).toBe(testAdminUser);
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });

    it('should reject a forged x-tailscale-user header from a client outside the trusted proxies', async () => {
      const mockClient: any = {
        handshake: {
          address: '203.0.113.9',
          headers: { 'x-tailscale-user': 'admin@tailscale' },
        },
        data: {},
        disconnect: jest.fn(),
        emit: jest.fn(),
      };

      await gateway.handleConnection(mockClient);

      expect(mockClient.data.user).toBeUndefined();
      expect(mockClient.emit).toHaveBeenCalledWith('unauthorized', expect.any(Object));
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should reject connection when token is invalid or missing', async () => {
      const mockClient: any = {
        handshake: {
          auth: { token: 'invalid-token' },
        },
        data: {},
        disconnect: jest.fn(),
        emit: jest.fn(),
      };

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(mockClient.emit).toHaveBeenCalledWith('unauthorized', expect.any(Object));
    });
  });

  describe('join_terminal & log_history (RF-RCON-13)', () => {
    it('should allow ADMIN to join terminal and receive initial log_history', async () => {
      const mockClient: any = {
        data: { user: testAdminUser },
        join: jest.fn(),
        emit: jest.fn(),
      };

      const result = await gateway.handleJoinTerminal(mockClient, {
        serverId: testServer.id,
      });

      expect(mockClient.join).toHaveBeenCalledWith(testServer.id);
      expect(mockClient.emit).toHaveBeenCalledWith('log_history', {
        serverId: testServer.id,
        lines: [{ id: '1', timestamp: '12:00:00', level: 'INFO', message: 'World loaded' }],
      });
      // A returned { event, data } would be re-emitted by Nest and reach the SPA twice.
      expect(result).toBeUndefined();
      expect(mockClient.emit).toHaveBeenCalledTimes(1);
    });

    it('segue os logs do pod pelo resource_name, não pelo subdomínio', async () => {
      const mockClient: any = { data: { user: testAdminUser }, join: jest.fn(), emit: jest.fn() };

      await gateway.handleJoinTerminal(mockClient, { serverId: testServer.id });

      expect(mockLogStreamer.attachServerStream).toHaveBeenCalledWith(
        testServer.id,
        'survival',
        expect.any(Function),
        expect.objectContaining({ shouldRetry: expect.any(Function) }),
      );
    });

    it('abre o log do pod pelo KubernetesService e só reabre enquanto a sala tem clientes', async () => {
      const mockClient: any = { data: { user: testAdminUser }, join: jest.fn(), emit: jest.fn() };
      const rooms = new Map<string, Set<string>>();
      gateway.server = { ...mockSocketServer, sockets: { adapter: { rooms } } };

      await gateway.handleJoinTerminal(mockClient, { serverId: testServer.id });
      const [, , openStream, options] = mockLogStreamer.attachServerStream.mock.calls[0];

      await openStream();
      expect(mockK8sService.streamServerLogs).toHaveBeenCalledWith(
        expect.objectContaining({ id: testServer.id }),
      );
      expect(options.shouldRetry()).toBe(false);
      rooms.set(testServer.id, new Set(['socket-1']));
      expect(options.shouldRetry()).toBe(true);
    });

    it('should deny PLAYER without server access from joining terminal', async () => {
      const unauthorizedPlayer: User = {
        id: 'unauth-player-id',
        role: 'PLAYER',
      } as any;

      const mockClient: any = {
        data: { user: unauthorizedPlayer },
        join: jest.fn(),
        emit: jest.fn(),
      };

      await gateway.handleJoinTerminal(mockClient, { serverId: testServer.id });

      expect(mockClient.join).not.toHaveBeenCalled();
      expect(mockClient.emit).toHaveBeenCalledWith('error', expect.any(Object));
    });

    it('should deny PLAYER with direct server access from joining terminal (#209)', async () => {
      const mockClient: any = {
        data: { user: testPlayerUser },
        join: jest.fn(),
        emit: jest.fn(),
      };

      await gateway.handleJoinTerminal(mockClient, { serverId: testServer.id });

      expect(mockClient.join).not.toHaveBeenCalled();
      expect(mockClient.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringMatching(/unauthorized/i) }),
      );
    });
  });

  describe('send_command & audit logging (RF-RCON-12, RF-RCON-13, Critério de Aceite)', () => {
    it('should execute command via ConsoleDriver, emit command_output, and save audit log', async () => {
      const mockClient: any = {
        data: { user: testAdminUser },
        handshake: { address: '192.168.1.100' },
        emit: jest.fn(),
      };

      const result = await gateway.handleSendCommand(mockClient, {
        serverId: testServer.id,
        command: 'weather clear',
      });

      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledWith(testServer, 'weather clear');
      expect(result).toBeUndefined();

      // Critério de aceite: Comando pelo WebSocket gera linha em server_audit_logs
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: testServer.id,
          user_id: testAdminUser.id,
          command: 'weather clear',
          execution_source: 'TERMINAL_SESSION',
          ip_address: '192.168.1.100',
          response: 'Executed: weather clear',
        }),
      );

      expect(mockClient.emit).toHaveBeenCalledTimes(1);
      expect(mockClient.emit).toHaveBeenCalledWith(
        'command_output',
        expect.objectContaining({
          command: 'weather clear',
          output: 'Executed: weather clear',
          durationMs: expect.any(Number),
        }),
      );
    });

    it('should deny PLAYER with direct server access from sending commands (#209)', async () => {
      const mockClient: any = {
        data: { user: testPlayerUser },
        handshake: { address: '192.168.1.100' },
        emit: jest.fn(),
      };

      await gateway.handleSendCommand(mockClient, {
        serverId: testServer.id,
        command: 'weather clear',
      });

      expect(mockConsoleDriver.sendCommand).not.toHaveBeenCalled();
      expect(mockAuditRepo.save).not.toHaveBeenCalled();
      expect(mockClient.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringMatching(/unauthorized/i) }),
      );
    });
  });

  describe('rate limit de send_command (SRS 03: 5 comandos/s por sessão)', () => {
    const makeClient = (): any => ({
      data: { user: testAdminUser },
      handshake: { address: '192.168.1.100' },
      emit: jest.fn(),
    });
    const send = (client: any, command = 'list') =>
      gateway.handleSendCommand(client, { serverId: testServer.id, command });

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-03T12:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('recusa o 6º comando dentro de 1 s sem chegar ao RCON nem à auditoria', async () => {
      const client = makeClient();
      for (let i = 0; i < 5; i++) {
        await send(client);
      }

      const sixth = await send(client);

      expect(sixth).toBeUndefined();
      expect(client.emit).toHaveBeenLastCalledWith(
        'error',
        expect.objectContaining({ code: 'RATE_LIMITED' }),
      );
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledTimes(5);
      expect(mockAuditRepo.save).toHaveBeenCalledTimes(5);
    });

    it('volta a aceitar comandos quando a janela de 1 s passa', async () => {
      const client = makeClient();
      for (let i = 0; i < 5; i++) {
        await send(client);
      }
      jest.advanceTimersByTime(1000);

      await send(client);

      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledTimes(6);
    });

    it('conta por sessão: o limite de um socket não bloqueia outro', async () => {
      const noisy = makeClient();
      for (let i = 0; i < 6; i++) {
        await send(noisy);
      }

      await send(makeClient());

      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledTimes(6);
    });
  });
});
