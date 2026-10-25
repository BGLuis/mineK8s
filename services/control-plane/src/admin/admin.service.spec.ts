import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AccessDecisionEngineService } from '../tailscale/decision/access-decision-engine.service';
import { AccessResolverService } from '../tailscale/decision/access-resolver.service';

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
  let mockPlayerSessionsService: any;

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
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      create: jest.fn((dto) => dto),
      save: jest.fn(async (dto) => dto),
      delete: jest.fn(async () => ({ affected: 1 })),
    };

    mockAccessDecisionEngine = {
      evaluateAccess: jest.fn(() => ({ allowed: false, reason: 'NOT_IN_ALLOWED_GROUPS' })),
      evaluateNickname: jest.fn((declared: string, registered?: string) => {
        if (!registered) return { allowed: true, autoAdopted: true };
        if (declared.toLowerCase() === registered.toLowerCase())
          return { allowed: true, autoAdopted: false };
        return { allowed: false, autoAdopted: false, reason: 'IMPERSONATION_DETECTED' };
      }),
    };

    mockGatewayIpcService = {
      revokePlayerSession: jest.fn(async () => ({
        session_found: true,
        terminated_connections_count: 1,
      })),
      publishRoute: jest.fn(async () => {}),
      probePlayerIdentity: jest.fn(),
    };

    mockConsoleDriver = {
      sendCommand: jest.fn(async () => 'Kicked player'),
    };

    mockPlayerSessionsService = {
      list: jest.fn(() => []),
    };

    const accessResolver = new AccessResolverService(
      mockUserRepo,
      mockServerRepo,
      mockServerGroupRepo,
      mockUserGroupRepo,
      mockUserServerAccessRepo,
      mockGroupRepo,
      mockAccessDecisionEngine,
    );

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
      accessResolver,
      mockPlayerSessionsService,
    );
  });

  describe('Gestão de Grupos de Acesso (RF-ARQ-20)', () => {
    it('deve criar novo grupo de acesso com sucesso', async () => {
      mockGroupRepo.findOne.mockResolvedValue(null);

      const group = await service.createGroup({
        name: 'Veteranos',
        description: 'Jogadores antigos',
      });
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

    it('user with direct access only to world A is not treated as allowed on INDIVIDUAL world B when removed from group (#211)', async () => {
      const userId = 'u-player-1';
      const groupId = 'grp-legacy';

      mockUserGroupRepo.findOne.mockResolvedValue({ group_id: groupId, user_id: userId });
      mockUserRepo.findOne.mockResolvedValue({
        id: userId,
        minecraft_nick: 'Player1',
        role: 'PLAYER',
      });

      mockServerGroupRepo.find.mockResolvedValue([{ group_id: groupId, server_id: 'world-b' }]);

      const worldB = {
        id: 'world-b',
        subdomain: 'worldb',
        access_policy: 'INDIVIDUAL',
        is_maintenance: false,
        state: 'READY',
      };
      mockServerRepo.find.mockResolvedValue([worldB]);

      // User only has direct access to world-a, NOT world-b
      mockUserServerAccessRepo.find.mockResolvedValue([{ user_id: userId, server_id: 'world-a' }]);
      mockUserGroupRepo.find.mockResolvedValue([]);

      const result = await service.removeUserFromGroup(groupId, userId);

      expect(result.kickedServers).toContain('world-b');
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledWith(
        worldB,
        expect.stringContaining('kick Player1'),
      );
      expect(mockGatewayIpcService.revokePlayerSession).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: 'world-b',
          minecraft_nick: 'Player1',
        }),
      );
    });

    it('non-admin online in a world in maintenance is kicked when removed from group (#211)', async () => {
      const userId = 'u-player-2';
      const groupId = 'grp-maint';

      mockUserGroupRepo.findOne.mockResolvedValue({ group_id: groupId, user_id: userId });
      mockUserRepo.findOne.mockResolvedValue({
        id: userId,
        minecraft_nick: 'Player2',
        role: 'PLAYER',
      });

      mockServerGroupRepo.find.mockResolvedValue([{ group_id: groupId, server_id: 'world-maint' }]);

      const worldMaint = {
        id: 'world-maint',
        subdomain: 'maint',
        access_policy: 'GROUP',
        is_maintenance: true,
        state: 'READY',
      };
      mockServerRepo.find.mockResolvedValue([worldMaint]);
      mockUserGroupRepo.find.mockResolvedValue([{ user_id: userId, group_id: 'other-group' }]);

      const result = await service.removeUserFromGroup(groupId, userId);

      expect(result.kickedServers).toContain('world-maint');
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledWith(
        worldMaint,
        expect.stringContaining('kick Player2'),
      );
      expect(mockGatewayIpcService.revokePlayerSession).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: 'world-maint',
          minecraft_nick: 'Player2',
        }),
      );
    });
  });

  describe('Atualizações de rota e Smart Kick ao alterar servidores do grupo (#210)', () => {
    it('publica atualização de rota no gateway ao associar servidor ao grupo (#210)', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'grp-1', name: 'VIPs' });
      mockServerRepo.findOne.mockResolvedValue({ id: 'srv-1', name: 'Survival' });
      mockServerGroupRepo.findOne.mockResolvedValue(null);

      await service.addServerToGroup('grp-1', 'srv-1');

      expect(mockServerGroupRepo.save).toHaveBeenCalledWith({
        group_id: 'grp-1',
        server_id: 'srv-1',
      });
      expect(mockGatewayIpcService.publishRoute).toHaveBeenCalledWith('srv-1');
    });

    it('publica rota e chuta membros que perderam acesso ao remover servidor do grupo (#210)', async () => {
      const userLost = {
        id: 'u-lost',
        minecraft_nick: 'LostPlayer',
        role: 'PLAYER',
        user_groups: [{ group_id: 'grp-1' }],
        server_accesses: [],
      };
      const userKept = {
        id: 'u-kept',
        minecraft_nick: 'KeptPlayer',
        role: 'PLAYER',
        user_groups: [{ group_id: 'grp-1' }, { group_id: 'grp-2' }],
        server_accesses: [],
      };

      mockUserGroupRepo.find.mockResolvedValue([
        { user_id: 'u-lost', group_id: 'grp-1' },
        { user_id: 'u-kept', group_id: 'grp-1' },
      ]);

      mockUserRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where.id === 'u-lost') return userLost;
        if (where.id === 'u-kept') return userKept;
        return null;
      });

      const server = {
        id: 'srv-1',
        name: 'Survival',
        state: 'READY',
        access_policy: 'GROUP',
        server_groups: [{ group_id: 'grp-2', server_id: 'srv-1' }],
        is_maintenance: false,
      };
      mockServerRepo.findOne.mockResolvedValue(server);

      mockAccessDecisionEngine.evaluateAccess.mockImplementation((userCtx: any, serverCtx: any) => {
        const match = userCtx.groupIds.some((g: string) => serverCtx.allowedGroupIds.includes(g));
        return { allowed: match, reason: match ? 'MATCH' : 'NO_ACCESS' };
      });

      await service.removeServerFromGroup('grp-1', 'srv-1');

      expect(mockServerGroupRepo.delete).toHaveBeenCalledWith({
        group_id: 'grp-1',
        server_id: 'srv-1',
      });
      expect(mockGatewayIpcService.publishRoute).toHaveBeenCalledWith('srv-1');

      // u-lost lost access -> kicked via RCON and gateway IPC
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledWith(
        server,
        expect.stringContaining('kick LostPlayer'),
      );
      expect(mockGatewayIpcService.revokePlayerSession).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: 'srv-1',
          minecraft_nick: 'LostPlayer',
        }),
      );

      // u-kept still has grp-2 -> NOT kicked
      expect(mockConsoleDriver.sendCommand).not.toHaveBeenCalledWith(
        server,
        expect.stringContaining('kick KeptPlayer'),
      );
      expect(mockGatewayIpcService.revokePlayerSession).not.toHaveBeenCalledWith(
        expect.objectContaining({
          minecraft_nick: 'KeptPlayer',
        }),
      );
    });

    it('publica atualização de rota para cada servidor vinculado antes de deletar o grupo (#210)', async () => {
      mockGroupRepo.findOne.mockResolvedValue({ id: 'grp-1', name: 'VIPs' });
      mockServerGroupRepo.find.mockResolvedValue([
        { group_id: 'grp-1', server_id: 'srv-1' },
        { group_id: 'grp-1', server_id: 'srv-2' },
      ]);

      await service.deleteGroup('grp-1');

      expect(mockGroupRepo.delete).toHaveBeenCalledWith({ id: 'grp-1' });
      expect(mockGatewayIpcService.publishRoute).toHaveBeenCalledWith('srv-1');
      expect(mockGatewayIpcService.publishRoute).toHaveBeenCalledWith('srv-2');
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
      mockGatewayIpcService.revokePlayerSession.mockRejectedValue(
        new Error('Gateway is not connected'),
      );

      await expect(
        service.smartKick({ serverId: 'srv-creative', minecraftNick: 'ToxicPlayer' }),
      ).rejects.toThrow('Gateway is not connected');
    });
  });

  describe('Usuários e servidores acessíveis', () => {
    const user = { id: 'user-1', minecraft_nick: 'LucasCraft', real_name: 'Lucas', role: 'PLAYER' };

    beforeEach(() => {
      const accessResolver = new AccessResolverService(
        mockGroupRepo,
        mockServerRepo,
        mockServerGroupRepo,
        mockUserGroupRepo,
        mockUserServerAccessRepo,
        mockGroupRepo,
        new AccessDecisionEngineService(),
      );
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
        accessResolver,
        mockPlayerSessionsService,
      );
    });

    it('listUsers devolve nick, papel, dispositivos e ids de grupos', async () => {
      mockUserRepo.find.mockResolvedValue([
        {
          ...user,
          email: 'lucas@example.com',
          tailscale_user_id: 'ts-1',
          devices: [
            {
              id: 'dev-1',
              device_name: 'PC',
              status: 'ACTIVE',
              last_seen_at: null,
              node_ip: '100.64.0.9',
            },
          ],
          user_groups: [{ user_id: 'user-1', group_id: 'grp-1' }],
          server_accesses: [{ user_id: 'user-1', server_id: 'srv-1' }],
        },
      ]);

      const [summary] = await service.listUsers();

      expect(summary).toEqual({
        id: 'user-1',
        minecraftNick: 'LucasCraft',
        realName: 'Lucas',
        email: 'lucas@example.com',
        linked: true,
        role: 'PLAYER',
        devices: [{ id: 'dev-1', deviceName: 'PC', status: 'ACTIVE', lastSeenAt: null }],
        groupIds: ['grp-1'],
        serverIds: ['srv-1'],
      });
    });

    it('lista só os servidores que a política de acesso libera para o usuário', async () => {
      mockUserRepo.findOne.mockResolvedValue(user);
      mockServerRepo.find.mockResolvedValue([
        {
          id: 's-public',
          name: 'Público',
          subdomain: 'pub',
          state: 'READY',
          access_policy: 'PUBLIC',
        },
        {
          id: 's-group-ok',
          name: 'Do grupo',
          subdomain: 'grp',
          state: 'READY',
          access_policy: 'GROUP',
        },
        {
          id: 's-group-no',
          name: 'Outro grupo',
          subdomain: 'other',
          state: 'READY',
          access_policy: 'GROUP',
        },
        {
          id: 's-indiv-ok',
          name: 'Individual com acesso',
          subdomain: 'ind',
          state: 'STOPPED',
          access_policy: 'INDIVIDUAL',
        },
        {
          id: 's-indiv-no',
          name: 'Individual sem acesso',
          subdomain: 'ind2',
          state: 'READY',
          access_policy: 'INDIVIDUAL',
        },
        {
          id: 's-maint',
          name: 'Manutenção',
          subdomain: 'maint',
          state: 'READY',
          access_policy: 'MAINTENANCE',
        },
      ]);
      mockServerGroupRepo.find.mockResolvedValue([
        { server_id: 's-group-ok', group_id: 'grp-1' },
        { server_id: 's-group-no', group_id: 'grp-2' },
      ]);
      mockUserGroupRepo.find.mockResolvedValue([{ user_id: 'user-1', group_id: 'grp-1' }]);
      mockUserServerAccessRepo.find.mockResolvedValue([
        { user_id: 'user-1', server_id: 's-indiv-ok' },
      ]);

      const servers = await service.listAccessibleServers('user-1');

      expect(servers.map((s) => s.id)).toEqual(['s-public', 's-group-ok', 's-indiv-ok']);
    });

    it('servidor em modo manutenção sai da lista de jogadores, como o Gateway o enxerga', async () => {
      mockUserRepo.findOne.mockResolvedValue(user);
      mockServerRepo.find.mockResolvedValue([
        {
          id: 's-1',
          name: 'Em manutenção',
          subdomain: 'm',
          state: 'READY',
          access_policy: 'PUBLIC',
          is_maintenance: true,
        },
      ]);

      expect(await service.listAccessibleServers('user-1')).toEqual([]);
    });

    it('administrador enxerga todos os servidores, até os em manutenção', async () => {
      mockUserRepo.findOne.mockResolvedValue({ ...user, role: 'ADMIN' });
      mockServerRepo.find.mockResolvedValue([
        {
          id: 's-maint',
          name: 'Manutenção',
          subdomain: 'maint',
          state: 'READY',
          access_policy: 'MAINTENANCE',
        },
      ]);

      const servers = await service.listAccessibleServers('user-1');

      expect(servers.map((s) => s.id)).toEqual(['s-maint']);
    });

    it('responde 404 para usuário inexistente', async () => {
      await expect(service.listAccessibleServers('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('explainUserAccess (#211)', () => {
    it('returns access explanation for all worlds', async () => {
      mockAccessDecisionEngine.evaluateAccess.mockImplementation((_u: any, s: any) => {
        if (s.policy === 'PUBLIC') return { allowed: true };
        return { allowed: false, reason: 'NOT_IN_ALLOWED_GROUPS' };
      });
      const user = { id: 'u-1', role: 'PLAYER' };
      mockUserRepo.findOne.mockResolvedValue(user);
      mockServerRepo.find.mockResolvedValue([
        {
          id: 's-1',
          name: 'World 1',
          subdomain: 'w1',
          state: 'READY',
          access_policy: 'PUBLIC',
          is_maintenance: false,
        },
        {
          id: 's-2',
          name: 'World 2',
          subdomain: 'w2',
          state: 'STOPPED',
          access_policy: 'GROUP',
          is_maintenance: false,
        },
      ]);

      const explanations = await service.explainUserAccess('u-1');

      expect(explanations).toHaveLength(2);
      expect(explanations[0]).toMatchObject({
        id: 's-1',
        allowed: true,
        grantedBy: { kind: 'POLICY', policy: 'PUBLIC' },
      });
      expect(explanations[1]).toMatchObject({
        id: 's-2',
        allowed: false,
        grantedBy: null,
      });
    });

    it('throws NotFoundException if user does not exist', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      await expect(service.explainUserAccess('u-none')).rejects.toThrow(NotFoundException);
    });
  });

  describe('grantServerToUser (#212)', () => {
    it('throws NotFoundException if user does not exist', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      await expect(service.grantServerToUser('u-bad', 's-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if server does not exist', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 'u-1' });
      mockServerRepo.findOne.mockResolvedValue(null);
      await expect(service.grantServerToUser('u-1', 's-bad')).rejects.toThrow(NotFoundException);
    });

    it('saves direct access and publishes route to gateway', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 'u-1' });
      mockServerRepo.findOne.mockResolvedValue({ id: 's-1' });
      mockUserServerAccessRepo.findOne.mockResolvedValue(null);

      await service.grantServerToUser('u-1', 's-1');

      expect(mockUserServerAccessRepo.save).toHaveBeenCalledWith({
        user_id: 'u-1',
        server_id: 's-1',
      });
      expect(mockGatewayIpcService.publishRoute).toHaveBeenCalledWith('s-1');
    });

    it('does not duplicate if already granted but still publishes route', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 'u-1' });
      mockServerRepo.findOne.mockResolvedValue({ id: 's-1' });
      mockUserServerAccessRepo.findOne.mockResolvedValue({ user_id: 'u-1', server_id: 's-1' });

      await service.grantServerToUser('u-1', 's-1');

      expect(mockUserServerAccessRepo.save).not.toHaveBeenCalled();
      expect(mockGatewayIpcService.publishRoute).toHaveBeenCalledWith('s-1');
    });
  });

  describe('revokeServerFromUser (#212)', () => {
    it('throws NotFoundException if user does not exist', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      await expect(service.revokeServerFromUser('u-bad', 's-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if server does not exist', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 'u-1' });
      mockServerRepo.findOne.mockResolvedValue(null);
      await expect(service.revokeServerFromUser('u-1', 's-bad')).rejects.toThrow(NotFoundException);
    });

    it('deletes access and triggers smart kick if user loses access to INDIVIDUAL world', async () => {
      const user = { id: 'u-1', minecraft_nick: 'Steve', role: 'PLAYER' };
      const server = {
        id: 's-indiv',
        access_policy: 'INDIVIDUAL',
        state: 'READY',
        is_maintenance: false,
      };

      mockUserRepo.findOne.mockResolvedValue(user);
      mockServerRepo.findOne.mockResolvedValue(server);
      mockUserServerAccessRepo.find.mockResolvedValue([]);
      mockUserGroupRepo.find.mockResolvedValue([]);

      const result = await service.revokeServerFromUser('u-1', 's-indiv');

      expect(mockUserServerAccessRepo.delete).toHaveBeenCalledWith({
        user_id: 'u-1',
        server_id: 's-indiv',
      });
      expect(mockGatewayIpcService.publishRoute).toHaveBeenCalledWith('s-indiv');
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledWith(
        server,
        expect.stringContaining('kick Steve'),
      );
      expect(mockGatewayIpcService.revokePlayerSession).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: 's-indiv',
          minecraft_nick: 'Steve',
        }),
      );
      expect(result).toEqual({ kickedServers: ['s-indiv'] });
    });

    it('does not trigger smart kick if user remains authorized', async () => {
      const adminUser = { id: 'u-admin', minecraft_nick: 'AdminSteve', role: 'ADMIN' };
      const server = {
        id: 's-indiv',
        access_policy: 'INDIVIDUAL',
        state: 'READY',
        is_maintenance: false,
      };

      mockUserRepo.findOne.mockResolvedValue(adminUser);
      mockServerRepo.findOne.mockResolvedValue(server);
      mockUserServerAccessRepo.find.mockResolvedValue([]);
      mockUserGroupRepo.find.mockResolvedValue([]);
      mockAccessDecisionEngine.evaluateAccess.mockReturnValue({ allowed: true });

      const result = await service.revokeServerFromUser('u-admin', 's-indiv');

      expect(mockUserServerAccessRepo.delete).toHaveBeenCalledWith({
        user_id: 'u-admin',
        server_id: 's-indiv',
      });
      expect(mockGatewayIpcService.publishRoute).toHaveBeenCalledWith('s-indiv');
      expect(mockConsoleDriver.sendCommand).not.toHaveBeenCalled();
      expect(mockGatewayIpcService.revokePlayerSession).not.toHaveBeenCalled();
      expect(result).toEqual({ kickedServers: [] });
    });
  });

  describe('simulateAccessChanges (#213)', () => {
    it('simulating removeServerFromGroup does not modify server_groups and does not call publishRoute or revokePlayerSession', async () => {
      const user = { id: 'u-1', minecraft_nick: 'PlayerOne', role: 'PLAYER' };
      const server = { id: 's-1', name: 'Server One', access_policy: 'GROUP' };

      mockUserRepo.find.mockResolvedValue([user]);
      mockServerRepo.find.mockResolvedValue([server]);
      mockServerGroupRepo.find.mockResolvedValue([{ group_id: 'g-1', server_id: 's-1' }]);
      mockUserGroupRepo.find.mockResolvedValue([{ user_id: 'u-1', group_id: 'g-1' }]);
      mockUserServerAccessRepo.find.mockResolvedValue([]);

      mockAccessDecisionEngine.evaluateAccess.mockImplementation((uCtx: any, sCtx: any) => {
        const allowed = sCtx.allowedGroupIds?.includes('g-1') && uCtx.groupIds?.includes('g-1');
        return { allowed: Boolean(allowed) };
      });

      const results = await service.simulateAccessChanges({
        changes: [{ type: 'removeServerFromGroup', serverId: 's-1', groupId: 'g-1' }],
      });

      // Verify no persistence or IPC calls were made
      expect(mockServerGroupRepo.delete).not.toHaveBeenCalled();
      expect(mockServerGroupRepo.save).not.toHaveBeenCalled();
      expect(mockGatewayIpcService.publishRoute).not.toHaveBeenCalled();
      expect(mockGatewayIpcService.revokePlayerSession).not.toHaveBeenCalled();
      expect(mockConsoleDriver.sendCommand).not.toHaveBeenCalled();

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        userId: 'u-1',
        minecraftNick: 'PlayerOne',
        gains: [],
        losses: ['s-1'],
        wouldBeKicked: [],
      });
    });

    it('simulating removeUserFromGroup returns in losses / wouldBeKicked the exact worlds that removeUserFromGroup would kick after saving under the same state', async () => {
      const user = { id: 'u-2', minecraft_nick: 'OnlinePlayer', role: 'PLAYER' };
      const server = {
        id: 's-world',
        name: 'Active World',
        access_policy: 'GROUP',
        state: 'READY',
      };

      let userGroups = [{ user_id: 'u-2', group_id: 'g-kick' }];
      mockUserRepo.find.mockResolvedValue([user]);
      mockUserRepo.findOne.mockResolvedValue(user);
      mockServerRepo.find.mockResolvedValue([server]);
      mockServerRepo.findOne.mockResolvedValue(server);
      mockServerGroupRepo.find.mockResolvedValue([{ group_id: 'g-kick', server_id: 's-world' }]);
      mockUserGroupRepo.findOne.mockResolvedValue({ group_id: 'g-kick', user_id: 'u-2' });
      mockUserGroupRepo.find.mockImplementation(async () => userGroups);
      mockUserGroupRepo.delete.mockImplementation(async () => {
        userGroups = [];
        return { affected: 1 };
      });
      mockUserServerAccessRepo.find.mockResolvedValue([]);

      // Active session in s-world
      mockPlayerSessionsService.list.mockImplementation((sId: string) =>
        sId === 's-world' ? [{ nick: 'OnlinePlayer', sessionId: 'sess-abc' }] : [],
      );

      mockAccessDecisionEngine.evaluateAccess.mockImplementation((uCtx: any, sCtx: any) => {
        const hasGroup =
          uCtx.groupIds?.includes('g-kick') && sCtx.allowedGroupIds?.includes('g-kick');
        return { allowed: Boolean(hasGroup) };
      });

      // 1. Run simulation
      const simResults = await service.simulateAccessChanges({
        changes: [{ type: 'removeUserFromGroup', userId: 'u-2', groupId: 'g-kick' }],
      });

      expect(simResults).toHaveLength(1);
      expect(simResults[0].losses).toEqual(['s-world']);
      expect(simResults[0].wouldBeKicked).toEqual(['s-world']);

      // 2. Run actual removeUserFromGroup with the same state and verify kick matches
      const kickResult = await service.removeUserFromGroup('g-kick', 'u-2');
      expect(kickResult.kickedServers).toEqual(simResults[0].wouldBeKicked);
    });

    it('a user who remains authorized through another group does not appear in losses', async () => {
      const user = { id: 'u-3', minecraft_nick: 'DualGroupPlayer', role: 'PLAYER' };
      const server = { id: 's-shared', name: 'Shared Server', access_policy: 'GROUP' };

      mockUserRepo.find.mockResolvedValue([user]);
      mockServerRepo.find.mockResolvedValue([server]);
      mockServerGroupRepo.find.mockResolvedValue([
        { group_id: 'g-1', server_id: 's-shared' },
        { group_id: 'g-2', server_id: 's-shared' },
      ]);
      mockUserGroupRepo.find.mockResolvedValue([
        { user_id: 'u-3', group_id: 'g-1' },
        { user_id: 'u-3', group_id: 'g-2' },
      ]);
      mockUserServerAccessRepo.find.mockResolvedValue([]);

      // As long as the user has either g-1 or g-2, allowed is true
      mockAccessDecisionEngine.evaluateAccess.mockImplementation((uCtx: any, sCtx: any) => {
        const match = uCtx.groupIds?.some((gid: string) => sCtx.allowedGroupIds?.includes(gid));
        return { allowed: Boolean(match) };
      });

      const results = await service.simulateAccessChanges({
        changes: [{ type: 'removeUserFromGroup', userId: 'u-3', groupId: 'g-1' }],
      });

      const user3Result = results.find((r) => r.userId === 'u-3');
      expect(user3Result).toBeUndefined();
    });
  });

  describe('getAccessMatrix (#214)', () => {
    it('makes the exact same number of repository queries (<= 5) with 3 users and with 30 users', async () => {
      const servers = [
        { id: 's-1', name: 'Server A', access_policy: 'GROUP' },
        { id: 's-2', name: 'Server B', access_policy: 'PUBLIC' },
      ];
      mockServerRepo.find.mockResolvedValue(servers);
      mockServerGroupRepo.find.mockResolvedValue([{ server_id: 's-1', group_id: 'g-1' }]);
      mockUserServerAccessRepo.find.mockResolvedValue([]);

      // 1. Run with 3 users
      const users3 = Array.from({ length: 3 }, (_, i) => ({
        id: `user-${i}`,
        minecraft_nick: `Player${i}`,
        role: 'PLAYER' as const,
      }));
      mockUserRepo.find.mockResolvedValue(users3);
      mockUserGroupRepo.find.mockResolvedValue(
        users3.map((u) => ({ user_id: u.id, group_id: 'g-1' })),
      );

      jest.clearAllMocks();
      const matrix3 = await service.getAccessMatrix();

      const queries3 =
        mockUserRepo.find.mock.calls.length +
        mockServerRepo.find.mock.calls.length +
        mockServerGroupRepo.find.mock.calls.length +
        mockUserGroupRepo.find.mock.calls.length +
        mockUserServerAccessRepo.find.mock.calls.length;

      expect(matrix3.users).toHaveLength(3);
      expect(queries3).toBeLessThanOrEqual(5);

      // 2. Run with 30 users
      const users30 = Array.from({ length: 30 }, (_, i) => ({
        id: `user-${i}`,
        minecraft_nick: `Player${i}`,
        role: 'PLAYER' as const,
      }));
      mockUserRepo.find.mockResolvedValue(users30);
      mockUserGroupRepo.find.mockResolvedValue(
        users30.map((u) => ({ user_id: u.id, group_id: 'g-1' })),
      );

      jest.clearAllMocks();
      const matrix30 = await service.getAccessMatrix();

      const queries30 =
        mockUserRepo.find.mock.calls.length +
        mockServerRepo.find.mock.calls.length +
        mockServerGroupRepo.find.mock.calls.length +
        mockUserGroupRepo.find.mock.calls.length +
        mockUserServerAccessRepo.find.mock.calls.length;

      expect(matrix30.users).toHaveLength(30);
      expect(queries30).toBeLessThanOrEqual(5);
      expect(queries30).toBe(queries3);
    });

    it('every cell[userId][serverId] matches what explainUserAccess(userId) returns for that pair', async () => {
      const users = [
        { id: 'u-admin', minecraft_nick: 'AdminUser', role: 'ADMIN' as const, real_name: 'Boss' },
        { id: 'u-group', minecraft_nick: 'GroupPlayer', role: 'PLAYER' as const, real_name: null },
        {
          id: 'u-direct',
          minecraft_nick: 'DirectPlayer',
          role: 'PLAYER' as const,
          real_name: null,
        },
      ];

      const servers = [
        {
          id: 's-group',
          name: 'Group World',
          subdomain: 'group',
          access_policy: 'GROUP',
          state: 'READY',
          is_maintenance: false,
        },
        {
          id: 's-ind',
          name: 'Individual World',
          subdomain: 'ind',
          access_policy: 'INDIVIDUAL',
          state: 'READY',
          is_maintenance: false,
        },
        {
          id: 's-pub',
          name: 'Public World',
          subdomain: 'pub',
          access_policy: 'PUBLIC',
          state: 'READY',
          is_maintenance: false,
        },
      ];

      const serverGroups = [{ server_id: 's-group', group_id: 'g-1', group: { name: 'Vip' } }];
      const userGroups = [{ user_id: 'u-group', group_id: 'g-1' }];
      const userAccesses = [{ user_id: 'u-direct', server_id: 's-ind' }];

      mockUserRepo.find.mockResolvedValue(users);
      mockServerRepo.find.mockResolvedValue(servers);
      mockServerGroupRepo.find.mockResolvedValue(serverGroups);
      mockUserGroupRepo.find.mockResolvedValue(userGroups);
      mockUserServerAccessRepo.find.mockResolvedValue(userAccesses);

      mockUserRepo.findOne.mockImplementation(async ({ where }: any) => {
        return users.find((u) => u.id === where?.id) || null;
      });

      mockAccessDecisionEngine.evaluateAccess.mockImplementation((uCtx: any, sCtx: any) => {
        if (uCtx.role === 'ADMIN') return { allowed: true, reason: 'ADMIN_BYPASS' };
        if (sCtx.policy === 'PUBLIC') return { allowed: true, reason: 'PUBLIC_POLICY' };
        if (sCtx.policy === 'GROUP') {
          const match = uCtx.groupIds?.some((gid: string) => sCtx.allowedGroupIds?.includes(gid));
          return match
            ? { allowed: true, reason: 'GROUP_MATCH' }
            : { allowed: false, reason: 'INSUFFICIENT_GROUPS' };
        }
        if (sCtx.policy === 'INDIVIDUAL') {
          const direct = sCtx.allowedUserIds?.includes(uCtx.userId);
          return direct
            ? { allowed: true, reason: 'INDIVIDUAL_ALLOWED' }
            : { allowed: false, reason: 'INDIVIDUAL_ACCESS_DENIED' };
        }
        return { allowed: false, reason: 'DENIED' };
      });

      const matrix = await service.getAccessMatrix();

      expect(matrix.users).toHaveLength(3);
      expect(matrix.servers).toHaveLength(3);

      for (const u of users) {
        const userExpl = await service.explainUserAccess(u.id);

        for (const s of servers) {
          const cell = matrix.cells[u.id][s.id];
          const expl = userExpl.find((item) => item.id === s.id);

          expect(cell).toBeDefined();
          expect(expl).toBeDefined();
          expect(cell.allowed).toBe(expl!.allowed);
          expect(cell.reason).toBe(expl!.reason);
          expect(cell.grantedBy).toEqual(expl!.grantedBy);
        }
      }
    });
  });

  describe('probeIdentity (#215)', () => {
    it('returns full inspection result with WhoIs, user, matchedBy, wouldBind, nicknameCheck and accessible servers', async () => {
      const user = {
        id: 'u-1',
        minecraft_nick: 'Steve',
        real_name: 'Steve Rogers',
        email: 'steve@example.com',
        github_username: null,
        role: 'PLAYER' as const,
      };

      const server = {
        id: 's-1',
        name: 'Survival',
        subdomain: 'survival',
        state: 'READY',
        access_policy: 'PUBLIC',
        is_maintenance: false,
      };

      mockGatewayIpcService.probePlayerIdentity.mockResolvedValue({
        user,
        matchedBy: 'SHARED_EMAIL',
        wouldBind: true,
        networkIdentity: {
          userId: 'ts-123',
          loginName: 'steve@example.com',
          displayName: 'Steve R',
          nodeId: 'node-1',
          nodeName: 'steve-pc',
          nodeIp: '100.64.0.10',
          tags: [],
          isOwner: true,
        },
        pendingDevice: null,
      });

      mockUserRepo.findOne.mockResolvedValue(user);
      mockServerRepo.find.mockResolvedValue([server]);
      mockServerGroupRepo.find.mockResolvedValue([]);
      mockUserGroupRepo.find.mockResolvedValue([]);
      mockUserServerAccessRepo.find.mockResolvedValue([]);
      mockAccessDecisionEngine.evaluateAccess.mockReturnValue({
        allowed: true,
        reason: 'PUBLIC_POLICY',
      });

      const result = await service.probeIdentity({
        ip: '100.64.0.10',
        minecraftNick: 'Steve',
      });

      expect(mockGatewayIpcService.probePlayerIdentity).toHaveBeenCalledWith({
        clientIp: '100.64.0.10',
        tailscaleUserId: undefined,
      });

      expect(result.whois).toMatchObject({
        loginName: 'steve@example.com',
        nodeIp: '100.64.0.10',
      });
      expect(result.user).toMatchObject({
        id: 'u-1',
        minecraftNick: 'Steve',
        realName: 'Steve Rogers',
      });
      expect(result.matchedBy).toBe('SHARED_EMAIL');
      expect(result.wouldBind).toBe(true);
      expect(result.nicknameCheck).toEqual({
        allowed: true,
        autoAdopted: false,
      });
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0]).toMatchObject({
        id: 's-1',
        allowed: true,
      });
    });

    it('a minecraftNick different from the registered user nick returns reason: IMPERSONATION_DETECTED (allowed: false)', async () => {
      const user = {
        id: 'u-1',
        minecraft_nick: 'Steve',
        role: 'PLAYER' as const,
      };

      mockGatewayIpcService.probePlayerIdentity.mockResolvedValue({
        user,
        matchedBy: 'TAILSCALE_USER_ID',
        wouldBind: false,
        networkIdentity: null,
        pendingDevice: null,
      });

      mockUserRepo.findOne.mockResolvedValue(user);
      mockServerRepo.find.mockResolvedValue([]);

      const result = await service.probeIdentity({
        tailscaleUserId: 'ts-1',
        minecraftNick: 'ImpostorNick',
      });

      expect(result.nicknameCheck).toEqual({
        allowed: false,
        autoAdopted: false,
        reason: 'IMPERSONATION_DETECTED',
      });
    });

    it('probing with no matched user returns user: null and empty servers list', async () => {
      mockGatewayIpcService.probePlayerIdentity.mockResolvedValue({
        user: null,
        matchedBy: 'NONE',
        wouldBind: false,
        networkIdentity: null,
        pendingDevice: null,
      });

      const result = await service.probeIdentity({
        ip: '100.99.99.99',
      });

      expect(result.user).toBeNull();
      expect(result.matchedBy).toBe('NONE');
      expect(result.wouldBind).toBe(false);
      expect(result.nicknameCheck).toBeNull();
      expect(result.servers).toEqual([]);
    });
  });
});
