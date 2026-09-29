import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppConfigService } from '@config/app-config.service';
import { User } from '@database/entities/user.entity';

import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { JwtService } from './jwt.service';
import { RolesGuard } from './roles.guard';

describe('Auth & RBAC Module (RF-ARQ-24, PR-15, L-01)', () => {
  let jwtService: JwtService;
  let authService: AuthService;
  let authGuard: AuthGuard;
  let rolesGuard: RolesGuard;
  let reflector: Reflector;

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
    authService = new AuthService(mockUserRepository, jwtService, mockConfigService);
    authGuard = new AuthGuard(reflector, jwtService, authService);
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

      expect(result.message).toContain('sucesso');
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

    it('should generate JWT on valid login', async () => {
      mockUsers.push({
        id: 'u-1',
        minecraft_nick: 'Alex',
        role: 'PLAYER',
      } as User);

      const res = await authService.login({ minecraft_nick: 'Alex' });
      expect(res.access_token).toBeDefined();
      expect(res.user.minecraft_nick).toBe('Alex');
    });

    it('should throw on login with unknown user', async () => {
      await expect(
        authService.login({ minecraft_nick: 'UnknownPlayer' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('AuthGuard (RF-ARQ-24 Acceptance Criteria: 401 without credential)', () => {
    const createMockContext = (headers: Record<string, string>, isPublic = false) => {
      reflector.getAllAndOverride = jest.fn(() => isPublic);
      return {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({
          getRequest: () => ({
            headers,
          }),
        }),
      } as any;
    };

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
        switchToHttp: () => ({ getRequest: () => req }),
      };

      const canActivate = await authGuard.canActivate(ctx);
      expect(canActivate).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.minecraft_nick).toBe('Steve');
    });

    it('should permit access with valid Tailscale identity header', async () => {
      mockUsers.push({
        id: 'ts-user-id',
        minecraft_nick: 'TailscaleAdmin',
        tailscale_user_id: 'ts-12345',
        role: 'ADMIN',
      } as User);

      const req: any = {
        headers: {
          'x-tailscale-user': 'ts-12345',
        },
      };
      reflector.getAllAndOverride = jest.fn(() => false);
      const ctx: any = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({ getRequest: () => req }),
      };

      const canActivate = await authGuard.canActivate(ctx);
      expect(canActivate).toBe(true);
      expect(req.user.minecraft_nick).toBe('TailscaleAdmin');
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
