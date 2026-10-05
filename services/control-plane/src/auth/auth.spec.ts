import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppConfigService } from '@config/app-config.service';
import { User } from '@database/entities/user.entity';

import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { JwtService } from './jwt.service';
import { RolesGuard } from './roles.guard';
import { TrustedProxyService } from './trusted-proxy.service';

const personalDevice = (userId: string) => ({ userId, isOwner: true, tags: [] as string[] });
const taggedDevice = (userId: string) => ({ userId, isOwner: false, tags: ['tag:server'] });

describe('Auth & RBAC Module (RF-ARQ-24, PR-15, L-01)', () => {
  let jwtService: JwtService;
  let authService: AuthService;
  let authGuard: AuthGuard;
  let rolesGuard: RolesGuard;
  let reflector: Reflector;
  let trustedProxies: TrustedProxyService;
  let tailscaleDriver: { queryWhoIs: jest.Mock };

  const mockUsers: User[] = [];
  const mockUserRepository = {
    count: jest.fn(async () => mockUsers.filter((u) => u.role === 'ADMIN').length),
    findOne: jest.fn(async ({ where }: any) => {
      if (where.minecraft_nick) {
        return mockUsers.find((u) => u.minecraft_nick === where.minecraft_nick) || null;
      }
      if (where.id) {
        return mockUsers.find((u) => u.id === where.id) || null;
      }
      if (where.tailscale_user_id) {
        return mockUsers.find((u) => u.tailscale_user_id === where.tailscale_user_id) || null;
      }
      return null;
    }),
    create: jest.fn((dto: any) => ({
      id: '123e4567-e89b-12d3-a456-426614174000',
      ...dto,
      created_at: new Date(),
      updated_at: new Date(),
    })),
    save: jest.fn(async (user: any) => {
      mockUsers.push(user);
      return user;
    }),
  } as any;

  const mockConfigService = {
    jwt: {
      secret: 'super_secret_jwt_key_at_least_32_characters_long',
      expiration: '1d',
    },
    tailscale: {
      authEnabled: true,
    },
  } as any as AppConfigService;

  beforeEach(() => {
    mockUsers.length = 0;
    reflector = new Reflector();
    jwtService = new JwtService(mockConfigService);
    tailscaleDriver = { queryWhoIs: jest.fn(async () => null) };
    authService = new AuthService(
      mockUserRepository,
      jwtService,
      mockConfigService,
      tailscaleDriver as any,
    );
    trustedProxies = new TrustedProxyService({
      authTrustedProxyIps: ['10.0.0.5'],
    } as AppConfigService);
    authGuard = new AuthGuard(reflector, jwtService, authService, trustedProxies);
    rolesGuard = new RolesGuard(reflector);
  });

  describe('JwtService', () => {
    it('should sign and verify valid JWT tokens', () => {
      const token = jwtService.sign({
        sub: 'user-123',
        nick: 'Steve',
        role: 'ADMIN',
      });

      expect(token).toBeDefined();
      const payload = jwtService.verify(token);
      expect(payload).toBeDefined();
      expect(payload?.sub).toBe('user-123');
      expect(payload?.nick).toBe('Steve');
      expect(payload?.role).toBe('ADMIN');
    });

    it('should reject tampered JWT tokens', () => {
      const token = jwtService.sign({ sub: 'user-1', nick: 'A', role: 'ADMIN' });
      const tampered = token.slice(0, -5) + 'abcde';
      expect(jwtService.verify(tampered)).toBeNull();
    });

    it('should reject expired JWT tokens', () => {
      const expiredToken = jwtService.sign(
        { sub: 'user-1', nick: 'A', role: 'ADMIN' },
        -10, // expired 10 seconds ago
      );
      expect(jwtService.verify(expiredToken)).toBeNull();
    });
  });

  describe('AuthService & Initial Admin Bootstrap (L-01)', () => {
    it('should bootstrap initial admin using valid token and invalidate it afterwards', async () => {
      authService.setBootstrapTokenForTesting('initial-bootstrap-token-123');

      const result = await authService.bootstrapAdmin({
        bootstrap_token: 'initial-bootstrap-token-123',
        minecraft_nick: 'SuperAdmin',
        email: 'admin@minek8s.local',
      });

      expect(result.message).toContain('successfully');
      expect(result.user.minecraft_nick).toBe('SuperAdmin');
      expect(result.user.role).toBe('ADMIN');
      expect(result.access_token).toBeDefined();

      // Token should now be invalidated
      expect(authService.getActiveBootstrapToken()).toBeNull();
      await expect(
        authService.bootstrapAdmin({
          bootstrap_token: 'initial-bootstrap-token-123',
          minecraft_nick: 'AnotherAdmin',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject bootstrap with invalid token', async () => {
      authService.setBootstrapTokenForTesting('token-correct');
      await expect(
        authService.bootstrapAdmin({
          bootstrap_token: 'token-wrong',
          minecraft_nick: 'Steve',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject duplicate nickname', async () => {
      authService.setBootstrapTokenForTesting('token-1');
      await authService.bootstrapAdmin({
        bootstrap_token: 'token-1',
        minecraft_nick: 'DuplicateNick',
      });

      authService.setBootstrapTokenForTesting('token-2');
      await expect(
        authService.bootstrapAdmin({
          bootstrap_token: 'token-2',
          minecraft_nick: 'DuplicateNick',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should link the first admin to the Tailscale account it is bootstrapped from', async () => {
      tailscaleDriver.queryWhoIs.mockResolvedValue(personalDevice('4242'));
      authService.setBootstrapTokenForTesting('token-1');

      const result = await authService.bootstrapAdmin(
        { bootstrap_token: 'token-1', minecraft_nick: 'SuperAdmin' },
        '100.101.102.103',
      );

      expect(tailscaleDriver.queryWhoIs).toHaveBeenCalledWith('100.101.102.103');
      expect(result.user.tailscale_user_id).toBe('4242');
    });

    it('should bootstrap the admin unlinked from a tagged device, whose owner is shared by every tagged node (#136)', async () => {
      tailscaleDriver.queryWhoIs.mockResolvedValue(taggedDevice('77'));
      authService.setBootstrapTokenForTesting('token-1');

      const result = await authService.bootstrapAdmin(
        { bootstrap_token: 'token-1', minecraft_nick: 'SuperAdmin' },
        '100.101.102.103',
      );

      expect(result.user.tailscale_user_id).toBeNull();
    });

    it('should still bootstrap the admin, unlinked, when WhoIs is unavailable', async () => {
      tailscaleDriver.queryWhoIs.mockRejectedValue(new Error('socket missing'));
      authService.setBootstrapTokenForTesting('token-1');

      const result = await authService.bootstrapAdmin(
        { bootstrap_token: 'token-1', minecraft_nick: 'SuperAdmin' },
        '100.101.102.103',
      );

      expect(result.user.tailscale_user_id).toBeNull();
    });
  });

  describe('AuthService.createSession (#91: identity from WhoIs, never from the request)', () => {
    const admin = {
      id: 'u-admin',
      minecraft_nick: 'Boss',
      role: 'ADMIN',
      tailscale_user_id: '4242',
    } as User;

    beforeEach(() => mockUsers.push(admin));

    it('issues a JWT for the account linked to the Tailscale user that owns the IP', async () => {
      tailscaleDriver.queryWhoIs.mockResolvedValue(personalDevice('4242'));

      const session = await authService.createSession('100.101.102.103');

      expect(tailscaleDriver.queryWhoIs).toHaveBeenCalledWith('100.101.102.103');
      expect(session.user).toBe(admin);
      expect(jwtService.verify(session.access_token)).toMatchObject({
        sub: 'u-admin',
        role: 'ADMIN',
      });
    });

    it('refuses a tagged device even when its shared owner id is linked to an admin (#136)', async () => {
      mockUsers.push({
        id: 'u-tagged',
        minecraft_nick: 'Tagged',
        role: 'ADMIN',
        tailscale_user_id: '77',
      } as User);
      tailscaleDriver.queryWhoIs.mockResolvedValue(taggedDevice('77'));

      await expect(authService.createSession('100.101.102.200')).rejects.toThrow(
        /Tagged devices cannot open/,
      );
    });

    it('refuses an address that is not on the tailnet', async () => {
      tailscaleDriver.queryWhoIs.mockResolvedValue(null);

      await expect(authService.createSession('203.0.113.9')).rejects.toThrow(UnauthorizedException);
    });

    it('refuses a Tailscale user with no linked account', async () => {
      tailscaleDriver.queryWhoIs.mockResolvedValue(personalDevice('9999'));

      await expect(authService.createSession('100.101.102.103')).rejects.toThrow(
        /No account is linked/,
      );
    });

    it('refuses an identity without a user id instead of matching unlinked accounts', async () => {
      mockUsers.push({
        id: 'u-unlinked',
        minecraft_nick: 'NoLink',
        role: 'ADMIN',
        tailscale_user_id: null,
      } as User);
      tailscaleDriver.queryWhoIs.mockResolvedValue(personalDevice(''));

      await expect(authService.createSession('100.101.102.103')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('fails closed with 503 when the Tailscale daemon cannot be asked', async () => {
      tailscaleDriver.queryWhoIs.mockRejectedValue(new Error('ENOENT'));

      await expect(authService.createSession('100.101.102.103')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('refuses when no client address could be determined', async () => {
      await expect(authService.createSession(null)).rejects.toThrow(UnauthorizedException);
      expect(tailscaleDriver.queryWhoIs).not.toHaveBeenCalled();
    });
  });

  describe('AuthGuard (RF-ARQ-24 Acceptance Criteria: 401 without credential)', () => {
    const createMockContext = (headers: Record<string, string>, isPublic = false) => {
      reflector.getAllAndOverride = jest.fn(() => isPublic);
      return {
        getHandler: () => {},
        getClass: () => {},
        getType: () => 'http',
        switchToHttp: () => ({
          getRequest: () => ({
            headers,
          }),
        }),
      } as any;
    };

    describe('mensagens de gateway WebSocket', () => {
      const wsContext = (client: any) => {
        reflector.getAllAndOverride = jest.fn(() => false);
        return {
          getHandler: () => {},
          getClass: () => {},
          getType: () => 'ws',
          switchToWs: () => ({ getClient: () => client }),
        } as any;
      };

      it('aceita o socket autenticado no handshake, sem procurar headers HTTP', async () => {
        await expect(
          authGuard.canActivate(wsContext({ data: { user: { id: 'u-1' } } })),
        ).resolves.toBe(true);
      });

      it('recusa socket sem usuário do handshake', async () => {
        await expect(authGuard.canActivate(wsContext({ data: {} }))).rejects.toThrow(
          UnauthorizedException,
        );
      });
    });

    it('should permit access when endpoint is marked @Public()', async () => {
      const ctx = createMockContext({}, true);
      const canActivate = await authGuard.canActivate(ctx);
      expect(canActivate).toBe(true);
    });

    it('should reject access with 401 when no credentials are provided', async () => {
      const ctx = createMockContext({}, false);
      await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('should permit access with valid Bearer JWT', async () => {
      mockUsers.push({
        id: 'user-admin-id',
        minecraft_nick: 'Steve',
        role: 'ADMIN',
      } as User);

      const token = jwtService.sign({
        sub: 'user-admin-id',
        nick: 'Steve',
        role: 'ADMIN',
      });

      const req: any = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      };
      reflector.getAllAndOverride = jest.fn(() => false);
      const ctx: any = {
        getHandler: () => {},
        getClass: () => {},
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => req }),
      };

      const canActivate = await authGuard.canActivate(ctx);
      expect(canActivate).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.minecraft_nick).toBe('Steve');
    });

    describe('x-tailscale-user header (#91)', () => {
      const guardRequest = (peer: string | undefined) => {
        const req: any = {
          headers: { 'x-tailscale-user': 'ts-12345' },
          socket: { remoteAddress: peer },
        };
        reflector.getAllAndOverride = jest.fn(() => false);
        const ctx: any = {
          getHandler: () => {},
          getClass: () => {},
          getType: () => 'http',
          switchToHttp: () => ({ getRequest: () => req }),
        };
        return { req, ctx };
      };

      beforeEach(() => {
        mockUsers.push({
          id: 'ts-user-id',
          minecraft_nick: 'TailscaleAdmin',
          tailscale_user_id: 'ts-12345',
          role: 'ADMIN',
        } as User);
      });

      it('is honored when it arrives from a trusted proxy', async () => {
        const { req, ctx } = guardRequest('10.0.0.5');

        await expect(authGuard.canActivate(ctx)).resolves.toBe(true);
        expect(req.user.minecraft_nick).toBe('TailscaleAdmin');
      });

      it('is ignored when forged by a client outside the trusted proxies', async () => {
        const { ctx } = guardRequest('203.0.113.9');

        await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      });

      it('is ignored when the peer address is unknown', async () => {
        const { ctx } = guardRequest(undefined);

        await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      });

      it('is ignored by default, when no proxy is configured', async () => {
        authGuard = new AuthGuard(
          reflector,
          jwtService,
          authService,
          new TrustedProxyService({ authTrustedProxyIps: [] } as unknown as AppConfigService),
        );
        const { ctx } = guardRequest('10.0.0.5');

        await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      });
    });
  });

  describe('RolesGuard (RBAC)', () => {
    it('should permit when no roles are required', () => {
      reflector.getAllAndOverride = jest.fn(() => null);
      const ctx = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({ getRequest: () => ({ user: { role: 'PLAYER' } }) }),
      } as any;

      expect(rolesGuard.canActivate(ctx)).toBe(true);
    });

    it('should permit when user has required role', () => {
      reflector.getAllAndOverride = jest.fn(() => ['ADMIN']);
      const ctx = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({ getRequest: () => ({ user: { role: 'ADMIN' } }) }),
      } as any;

      expect(rolesGuard.canActivate(ctx)).toBe(true);
    });

    it('should reject with 403 Forbidden when user does not have required role', () => {
      reflector.getAllAndOverride = jest.fn(() => ['ADMIN']);
      const ctx = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({ getRequest: () => ({ user: { role: 'PLAYER' } }) }),
      } as any;

      expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });
});
