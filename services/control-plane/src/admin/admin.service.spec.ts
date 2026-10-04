import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AccessDecisionEngineService } from '../tailscale/decision/access-decision-engine.service';

describe('AdminService (RF-ARQ-20, RF-TS-09, RF-GW-15)', () => {
  let service: AdminService;
  let mockGroupRepo: any;
  let mockUserRepo: any;
  let mockServerRepo: any;
  let mockUserGroupRepo: any;
  let mockServerGroupRepo: any;
  let mockUserServerAccessRepo: any;
  let mockAccessDecisionEngine: any;
  let mockGatewayIpcService: any;
  let mockConsoleDriver: any;

  beforeEach(() => {
    mockGroupRepo = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      create: jest.fn((dto) => ({ ...dto, id: 'grp-uuid-1' })),
      save: jest.fn(async (entity) => ({ ...entity, id: entity.id || 'grp-uuid-1' })),
      delete: jest.fn(async () => ({ affected: 1 })),
    };

    mockUserRepo = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
    };

    mockServerRepo = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
    };

    mockUserGroupRepo = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      create: jest.fn((dto) => dto),
      save: jest.fn(async (dto) => dto),
      delete: jest.fn(async () => ({ affected: 1 })),
    };

    mockServerGroupRepo = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      create: jest.fn((dto) => dto),
      save: jest.fn(async (dto) => dto),
      delete: jest.fn(async () => ({ affected: 1 })),
    };

    mockUserServerAccessRepo = {
      find: jest.fn(async () => []),
    };

    mockAccessDecisionEngine = {
      evaluateAccess: jest.fn(() => ({ allowed: false, reason: 'NOT_IN_ALLOWED_GROUPS' })),
    };

    mockGatewayIpcService = {
      revokePlayerSession: jest.fn(async () => ({ session_found: true, terminated_connections_count: 1 })),
    };

    mockConsoleDriver = {
      sendCommand: jest.fn(async () => 'Kicked player'),
    };

    service = new AdminService(
      mockGroupRepo,
      mockUserRepo,
      mockServerRepo,
      mockUserGroupRepo,
      mockServerGroupRepo,
      mockUserServerAccessRepo,
      mockAccessDecisionEngine,
      mockGatewayIpcService,
      mockConsoleDriver,
    );
  });

  describe('Gestão de Grupos de Acesso (RF-ARQ-20)', () => {
    it('deve criar novo grupo de acesso com sucesso', async () => {
      mockGroupRepo.findOne.mockResolvedValue(null);

      const group = await service.createGroup({ name: 'Veteranos', description: 'Jogadores antigos' });
      expect(group.name).toBe('Veteranos');
      expect(mockGroupRepo.save).toHaveBeenCalled();
    });

    it('deve rejeitar criação de grupo com nome duplicado', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'grp-1', name: 'Veteranos' });

      await expect(service.createGroup({ name: 'Veteranos' })).rejects.toThrow(ConflictException);
    });

    it('deve listar grupos cadastrados', async () => {
      mockGroupRepo.find.mockResolvedValue([
        { id: 'grp-1', name: 'Membros', user_groups: [], server_groups: [] },
      ]);

      const list = await service.listGroups();
      expect(list).toHaveLength(1);
    });
  });

  describe('Remover usuário do grupo com Smart Kick (Critério de Aceite RF-TS-09, E-06)', () => {
    it('Remover usuário do grupo desconecta a sessão ativa via RCON kick (Critério de Aceite)', async () => {
      const groupId = 'grp-veteranos-uuid';
      const userId = 'user-lucas-uuid';

      // 1. Simula que o usuário está no grupo
      mockUserGroupRepo.findOne.mockResolvedValue({
        group_id: groupId,
        user_id: userId,
      });

      // 2. Simula dados do usuário e seus vínculos
      const mockUser = {
        id: userId,
        minecraft_nick: 'LucasCraft',
        role: 'PLAYER',
        user_groups: [{ group_id: groupId }],
        server_accesses: [],
      };
      mockUserRepo.findOne.mockResolvedValue(mockUser);

      // 3. Simula servidor vinculado ao grupo
      mockServerGroupRepo.find.mockResolvedValue([
        { group_id: groupId, server_id: 'srv-modpack-atm9' },
      ]);

      const mockServer = {
        id: 'srv-modpack-atm9',
        subdomain: 'atm9',
        access_policy: 'GROUP',
        server_groups: [{ group_id: groupId }],
        minecraft_settings: {},
      };
      mockServerRepo.findOne.mockResolvedValue(mockServer);

      // 4. Decision Engine avalia que o usuário perdeu o acesso após ser removido
      mockAccessDecisionEngine.evaluateAccess.mockReturnValue({
        allowed: false,
        reason: 'NOT_IN_ALLOWED_GROUPS',
      });

      // Executa remoção
      const result = await service.removeUserFromGroup(groupId, userId);

      // Validações rigorosas do critério de aceite:
      // a) Vínculo de grupo foi deletado
      expect(mockUserGroupRepo.delete).toHaveBeenCalledWith({ group_id: groupId, user_id: userId });

      // b) RCON kick disparado no servidor Minecraft JVM (E-06)
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledWith(
        mockServer,
        'kick LucasCraft Permissao revogada pelo administrador',
      );

      // c) IPC disparado no Gateway L7
      expect(mockGatewayIpcService.revokePlayerSession).toHaveBeenCalledWith({
        server_id: 'srv-modpack-atm9',
        client_ip: '',
        minecraft_nick: 'LucasCraft',
        reason_message: '§cPermissão revogada pelo administrador.',
      });

      expect(result.kickedServers).toContain('srv-modpack-atm9');
    });

    it('NÃO deve desconectar se o usuário mantiver acesso através de outro grupo ativo', async () => {
      const groupId = 'grp-veteranos-uuid';
      const otherGroupId = 'grp-moderators-uuid';
      const userId = 'user-admin-uuid';

      mockUserGroupRepo.findOne.mockResolvedValue({
        group_id: groupId,
        user_id: userId,
      });

      const mockUser = {
        id: userId,
        minecraft_nick: 'AdminGuy',
        role: 'PLAYER',
        user_groups: [{ group_id: groupId }, { group_id: otherGroupId }],
        server_accesses: [],
      };
      mockUserRepo.findOne.mockResolvedValue(mockUser);

      mockServerGroupRepo.find.mockResolvedValue([
        { group_id: groupId, server_id: 'srv-survival' },
      ]);

      mockServerRepo.findOne.mockResolvedValue({
        id: 'srv-survival',
        access_policy: 'GROUP',
        server_groups: [{ group_id: groupId }, { group_id: otherGroupId }],
      });

      // Decision engine permite o acesso através do outro grupo restante
      mockAccessDecisionEngine.evaluateAccess.mockReturnValue({
        allowed: true,
        reason: 'GROUP_MATCH',
      });

      const result = await service.removeUserFromGroup(groupId, userId);

      expect(mockUserGroupRepo.delete).toHaveBeenCalled();
      expect(mockConsoleDriver.sendCommand).not.toHaveBeenCalled();
      expect(mockGatewayIpcService.revokePlayerSession).not.toHaveBeenCalled();
      expect(result.kickedServers).toHaveLength(0);
    });
  });

  describe('smartKick manual (RF-GW-15)', () => {
    it('deve disparar RCON kick e IPC gRPC de revogação para jogador específico', async () => {
      const mockServer = { id: 'srv-creative', subdomain: 'creative' };
      mockServerRepo.findOne.mockResolvedValue(mockServer);

      const res = await service.smartKick({
        serverId: 'srv-creative',
        minecraftNick: 'ToxicPlayer',
        reason: 'Comportamento inadequado',
      });

      expect(res).toEqual({ success: true, terminated_connections: 1 });
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledWith(
        mockServer,
        'kick ToxicPlayer Comportamento inadequado',
      );
      expect(mockGatewayIpcService.revokePlayerSession).toHaveBeenCalledWith({
        server_id: 'srv-creative',
        client_ip: '',
        minecraft_nick: 'ToxicPlayer',
        reason_message: 'Comportamento inadequado',
      });
    });
  });

  describe('smartKick manual: resultado do Gateway', () => {
    beforeEach(() => {
      mockServerRepo.findOne.mockResolvedValue({ id: 'srv-creative', subdomain: 'creative' });
    });

    it('devolve a contagem real de sessões derrubadas, inclusive 0', async () => {
      mockGatewayIpcService.revokePlayerSession.mockResolvedValue({
        session_found: false,
        terminated_connections_count: 0,
      });

      const res = await service.smartKick({ serverId: 'srv-creative', minecraftNick: 'Offline' });

      expect(res).toEqual({ success: true, terminated_connections: 0 });
    });

    it('propaga a falha do Gateway em vez de responder sucesso', async () => {
      mockGatewayIpcService.revokePlayerSession.mockRejectedValue(new Error('Gateway is not connected'));

      await expect(service.smartKick({ serverId: 'srv-creative', minecraftNick: 'ToxicPlayer' })).rejects.toThrow(
        'Gateway is not connected',
      );
    });
  });

  describe('Usuários e servidores acessíveis', () => {
    const user = { id: 'user-1', minecraft_nick: 'LucasCraft', real_name: 'Lucas', role: 'PLAYER' };

    beforeEach(() => {
      service = new AdminService(
        mockGroupRepo,
        mockUserRepo,
        mockServerRepo,
        mockUserGroupRepo,
        mockServerGroupRepo,
        mockUserServerAccessRepo,
        new AccessDecisionEngineService(),
        mockGatewayIpcService,
        mockConsoleDriver,
      );
    });

    it('listUsers devolve nick, papel, dispositivos e ids de grupos', async () => {
      mockUserRepo.find.mockResolvedValue([
        {
          ...user,
          devices: [{ id: 'dev-1', device_name: 'PC', status: 'ACTIVE', last_seen_at: null, node_ip: '100.64.0.9' }],
          user_groups: [{ user_id: 'user-1', group_id: 'grp-1' }],
        },
      ]);

      const [summary] = await service.listUsers();

      expect(summary).toEqual({
        id: 'user-1',
        minecraftNick: 'LucasCraft',
        realName: 'Lucas',
        role: 'PLAYER',
        devices: [{ id: 'dev-1', deviceName: 'PC', status: 'ACTIVE', lastSeenAt: null }],
        groupIds: ['grp-1'],
      });
    });

    it('lista só os servidores que a política de acesso libera para o usuário', async () => {
      mockUserRepo.findOne.mockResolvedValue(user);
      mockServerRepo.find.mockResolvedValue([
        { id: 's-public', name: 'Público', subdomain: 'pub', state: 'READY', access_policy: 'PUBLIC' },
        { id: 's-group-ok', name: 'Do grupo', subdomain: 'grp', state: 'READY', access_policy: 'GROUP' },
        { id: 's-group-no', name: 'Outro grupo', subdomain: 'other', state: 'READY', access_policy: 'GROUP' },
        { id: 's-indiv-ok', name: 'Individual com acesso', subdomain: 'ind', state: 'STOPPED', access_policy: 'INDIVIDUAL' },
        { id: 's-indiv-no', name: 'Individual sem acesso', subdomain: 'ind2', state: 'READY', access_policy: 'INDIVIDUAL' },
        { id: 's-maint', name: 'Manutenção', subdomain: 'maint', state: 'READY', access_policy: 'MAINTENANCE' },
      ]);
      mockServerGroupRepo.find.mockResolvedValue([
        { server_id: 's-group-ok', group_id: 'grp-1' },
        { server_id: 's-group-no', group_id: 'grp-2' },
      ]);
      mockUserGroupRepo.find.mockResolvedValue([{ user_id: 'user-1', group_id: 'grp-1' }]);
      mockUserServerAccessRepo.find.mockResolvedValue([{ user_id: 'user-1', server_id: 's-indiv-ok' }]);

      const servers = await service.listAccessibleServers('user-1');

      expect(servers.map((s) => s.id)).toEqual(['s-public', 's-group-ok', 's-indiv-ok']);
    });

    it('servidor em modo manutenção sai da lista de jogadores, como o Gateway o enxerga', async () => {
      mockUserRepo.findOne.mockResolvedValue(user);
      mockServerRepo.find.mockResolvedValue([
        { id: 's-1', name: 'Em manutenção', subdomain: 'm', state: 'READY', access_policy: 'PUBLIC', is_maintenance: true },
      ]);

      expect(await service.listAccessibleServers('user-1')).toEqual([]);
    });

    it('administrador enxerga todos os servidores, até os em manutenção', async () => {
      mockUserRepo.findOne.mockResolvedValue({ ...user, role: 'ADMIN' });
      mockServerRepo.find.mockResolvedValue([
        { id: 's-maint', name: 'Manutenção', subdomain: 'maint', state: 'READY', access_policy: 'MAINTENANCE' },
      ]);

      const servers = await service.listAccessibleServers('user-1');

      expect(servers.map((s) => s.id)).toEqual(['s-maint']);
    });

    it('responde 404 para usuário inexistente', async () => {
      await expect(service.listAccessibleServers('nope')).rejects.toThrow(NotFoundException);
    });
  });
});
