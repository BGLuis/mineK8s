import { WsException } from '@nestjs/websockets';
import { Server } from '../database/entities/server.entity';
import { ServerAuditLog } from '../database/entities/server-audit-log.entity';
import { User } from '../database/entities/user.entity';
import { UserServerAccess } from '../database/entities/user-server-access.entity';
import { ConsoleDriver } from '../console/console-driver.interface';
import { K8sLogStreamerService } from '../logging/k8s-log-streamer.service';
import { AuthService } from '../auth/auth.service';
import { JwtService } from '../auth/jwt.service';
import { TerminalGateway } from './terminal.gateway';

describe('TerminalGateway (RF-RCON-12, RF-RCON-13, RF-RCON-14, Guarda L-01)', () => {
  let gateway: TerminalGateway;
  let mockServerRepo: any;
  let mockAuditRepo: any;
  let mockAccessRepo: any;
  let mockConsoleDriver: any;
  let mockLogStreamer: any;
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
    subdomain: 'survival',
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
        if (
          where.user_id === testPlayerUser.id &&
          where.server_id === testServer.id
        ) {
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
        getHistory: jest.fn().mockReturnValue([
          { id: '1', timestamp: '12:00:00', level: 'INFO', message: 'World loaded' },
        ]),
      }),
      subscribeToDeltas: jest.fn().mockReturnValue(() => {}),
      attachServerStream: jest.fn().mockResolvedValue({}),
    };

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
      mockAccessRepo,
      mockConsoleDriver,
      mockLogStreamer,
      mockAuthService,
      mockJwtService,
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

    it('should authenticate client with x-tailscale-user header', async () => {
      const mockClient: any = {
        handshake: {
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
      expect(result?.data.lines).toHaveLength(1);
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

      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledWith(
        testServer,
        'weather clear',
      );
      expect(result?.data?.output).toBe('Executed: weather clear');
      expect(result?.data?.durationMs).toBeGreaterThanOrEqual(0);

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

      expect(mockClient.emit).toHaveBeenCalledWith('command_output', expect.objectContaining({
        command: 'weather clear',
        output: 'Executed: weather clear',
      }));
    });
  });
});
