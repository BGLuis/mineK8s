import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ROLES_KEY } from '../auth/roles.decorator';

describe('AdminController', () => {
  let controller: AdminController;
  let adminService: jest.Mocked<Partial<AdminService>>;

  beforeEach(() => {
    adminService = {
      listUsers: jest.fn(),
      listAccessibleServers: jest.fn(),
      explainUserAccess: jest.fn(),
      createGroup: jest.fn(),
      listGroups: jest.fn(),
      deleteGroup: jest.fn(),
      addUserToGroup: jest.fn(),
      removeUserFromGroup: jest.fn(),
      addServerToGroup: jest.fn(),
      removeServerFromGroup: jest.fn(),
      grantServerToUser: jest.fn(),
      revokeServerFromUser: jest.fn(),
      simulateAccessChanges: jest.fn(),
      getAccessMatrix: jest.fn(),
      probeIdentity: jest.fn(),
      smartKick: jest.fn(),
    };
    controller = new AdminController(adminService as AdminService);
  });

  it('has @Roles("ADMIN") class decorator metadata', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AdminController);
    expect(roles).toEqual(['ADMIN']);
  });

  describe('grantServerToUser', () => {
    it('calls adminService.grantServerToUser and returns { success: true }', async () => {
      (adminService.grantServerToUser as jest.Mock).mockResolvedValue(undefined);

      const result = await controller.grantServerToUser('user-1', { serverId: 'server-1' });

      expect(adminService.grantServerToUser).toHaveBeenCalledWith('user-1', 'server-1');
      expect(result).toEqual({ success: true });
    });

    it('propagates NotFoundException if user or server not found', async () => {
      (adminService.grantServerToUser as jest.Mock).mockRejectedValue(
        new NotFoundException('User not found'),
      );

      await expect(
        controller.grantServerToUser('bad-user', { serverId: 'server-1' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('addServerToGroup', () => {
    it('calls adminService.addServerToGroup and returns { success: true }', async () => {
      (adminService.addServerToGroup as jest.Mock).mockResolvedValue(undefined);

      const result = await controller.addServerToGroup('grp-1', { serverId: 'server-1' });

      expect(adminService.addServerToGroup).toHaveBeenCalledWith('grp-1', 'server-1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('revokeServerFromUser', () => {
    it('calls adminService.revokeServerFromUser and returns kicked servers', async () => {
      (adminService.revokeServerFromUser as jest.Mock).mockResolvedValue({
        kickedServers: ['server-1'],
      });

      const result = await controller.revokeServerFromUser('user-1', 'server-1');

      expect(adminService.revokeServerFromUser).toHaveBeenCalledWith('user-1', 'server-1');
      expect(result).toEqual({ kickedServers: ['server-1'] });
    });

    it('propagates NotFoundException if user or server not found', async () => {
      (adminService.revokeServerFromUser as jest.Mock).mockRejectedValue(
        new NotFoundException('Server not found'),
      );

      await expect(controller.revokeServerFromUser('user-1', 'bad-server')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('simulateAccess', () => {
    it('delegates to adminService.simulateAccessChanges', async () => {
      const mockResult = [
        {
          userId: 'u-1',
          minecraftNick: 'Steve',
          gains: [],
          losses: ['s-1'],
          wouldBeKicked: ['s-1'],
        },
      ];
      (adminService.simulateAccessChanges as jest.Mock).mockResolvedValue(mockResult);

      const dto = {
        changes: [{ type: 'removeUserFromGroup' as const, userId: 'u-1', groupId: 'g-1' }],
      };
      const result = await controller.simulateAccess(dto);

      expect(adminService.simulateAccessChanges).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('getAccessMatrix', () => {
    it('delegates to adminService.getAccessMatrix', async () => {
      const mockMatrix = {
        users: [
          {
            id: 'u-1',
            minecraftNick: 'Steve',
            realName: null,
            role: 'PLAYER' as const,
            groupIds: [],
          },
        ],
        servers: [
          {
            id: 's-1',
            name: 'Survival',
            subdomain: 'survival',
            state: 'READY',
            access_policy: 'PUBLIC',
            is_maintenance: false,
          },
        ],
        cells: { 'u-1': { 's-1': { allowed: true, reason: 'ALLOWED', grantedBy: null } } },
      };
      (adminService.getAccessMatrix as jest.Mock).mockResolvedValue(mockMatrix);

      const result = await controller.getAccessMatrix();

      expect(adminService.getAccessMatrix).toHaveBeenCalled();
      expect(result).toEqual(mockMatrix);
    });
  });

  describe('probeIdentity', () => {
    it('delegates to adminService.probeIdentity', async () => {
      const mockResult = {
        whois: null,
        user: null,
        matchedBy: 'NONE' as const,
        wouldBind: false,
        nicknameCheck: null,
        servers: [],
      };
      (adminService.probeIdentity as jest.Mock).mockResolvedValue(mockResult);

      const dto = { ip: '100.64.0.1', minecraftNick: 'Steve' };
      const result = await controller.probeIdentity(dto);

      expect(adminService.probeIdentity).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockResult);
    });
  });
});
