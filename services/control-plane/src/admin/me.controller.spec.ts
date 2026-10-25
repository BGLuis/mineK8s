import 'reflect-metadata';
import { MeController } from './me.controller';
import { AdminService } from './admin.service';
import { ROLES_KEY } from '../auth/roles.decorator';
import { User } from '../database/entities/user.entity';

describe('MeController (#216)', () => {
  let controller: MeController;
  let adminService: jest.Mocked<Partial<AdminService>>;

  beforeEach(() => {
    adminService = {
      listMyServers: jest.fn(),
    };
    controller = new MeController(adminService as AdminService);
  });

  it('has NO @Roles decorator metadata so both PLAYER and ADMIN can authenticate', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, MeController);
    expect(roles).toBeUndefined();
  });

  it('delegates listMyServers to adminService.listMyServers(req.user)', async () => {
    const user = { id: 'u-1', minecraft_nick: 'player1', role: 'PLAYER' } as User;
    const mockServers = [
      {
        name: 'Survival',
        address: 'survival.mc.example.com',
        state: 'READY',
        playersOnline: 2,
        icon: null,
      },
    ];
    (adminService.listMyServers as jest.Mock).mockResolvedValue(mockServers);

    const result = await controller.listMyServers({ user } as any);

    expect(adminService.listMyServers).toHaveBeenCalledWith(user);
    expect(result).toEqual(mockServers);
  });
});
