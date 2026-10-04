import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  BadGatewayException,
} from '@nestjs/common';
import { InvitesService } from './invites.service';
import { computeInviteStatus } from '../dto/invite-summary.dto';

describe('InvitesService', () => {
  let service: InvitesService;
  let mockInviteRepo: any;
  let mockInviteGroupRepo: any;
  let mockInviteServerRepo: any;
  let mockUserRepo: any;
  let mockUserGroupRepo: any;
  let mockUserServerAccessRepo: any;
  let mockDeviceRepo: any;
  let mockTailscaleCloudDriver: any;
  let mockServerRepo: any;

  beforeEach(() => {
    mockInviteRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'inv-uuid-1' })),
      save: jest.fn(async (entity) => ({ ...entity, id: entity.id || 'inv-uuid-1' })),
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      createQueryBuilder: jest.fn(),
    };

    mockInviteGroupRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (dto) => dto),
    };

    mockInviteServerRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (dto) => dto),
    };

    mockUserRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'user-uuid-1' })),
      save: jest.fn(async (user) => ({ ...user, id: user.id || 'user-uuid-1' })),
      findOne: jest.fn(async () => null),
      delete: jest.fn(async () => ({ affected: 1 })),
    };

    mockUserGroupRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (dto) => dto),
    };

    mockUserServerAccessRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (dto) => dto),
    };

    mockDeviceRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'dev-uuid-1' })),
      save: jest.fn(async (dto) => ({ ...dto, id: 'dev-uuid-1' })),
    };

    mockTailscaleCloudDriver = {
      generatePreAuthKey: jest.fn(async (tags: string[]) => ({
        key: 'tskey-auth-mock-12345',
        id: 'key-id-1',
        expires: new Date(Date.now() + 86400000 * 7),
        tags,
      })),
    };

    mockServerRepo = { find: jest.fn(async () => []) };

    service = new InvitesService(
      mockInviteRepo,
      mockInviteGroupRepo,
      mockInviteServerRepo,
      mockUserRepo,
      mockUserGroupRepo,
      mockUserServerAccessRepo,
      mockDeviceRepo,
      mockTailscaleCloudDriver,
      mockServerRepo,
    );
    service.setBaseUrl('https://mine.example.ts.net:3001');
  });

  describe('Ciclo de Vida do Convite (RF-TS-06: computeInviteStatus)', () => {
    it('deve retornar Revoked se is_active for falso', () => {
      const status = computeInviteStatus({
        is_active: false,
        used_count: 0,
        max_uses: 5,
        expires_at: new Date(Date.now() + 100000),
      });
      expect(status).toBe('Revoked');
    });

    it('deve retornar Depleted se used_count >= max_uses', () => {
      const status = computeInviteStatus({
        is_active: true,
        used_count: 5,
        max_uses: 5,
        expires_at: new Date(Date.now() + 100000),
      });
      expect(status).toBe('Depleted');
    });

    it('deve retornar Expired se expires_at estiver no passado', () => {
      const status = computeInviteStatus({
        is_active: true,
        used_count: 1,
        max_uses: 5,
        expires_at: new Date(Date.now() - 100000),
      });
      expect(status).toBe('Expired');
    });

    it('deve retornar Active quando convite for plenamente válido', () => {
      const status = computeInviteStatus({
        is_active: true,
        used_count: 1,
        max_uses: 5,
        expires_at: new Date(Date.now() + 100000),
      });
      expect(status).toBe('Active');
    });
  });

  describe('createInvite (RF-TS-03, RF-TS-11)', () => {
    it('deve criar convite com token criptográfico seguro e vínculos pré-atribuídos', async () => {
      const dto = {
        name: 'Turma do Discord',
        maxUses: 10,
        expiresInDays: 14,
        groupIds: ['grp-1'],
        serverIds: ['srv-1'],
      };

      const result = await service.createInvite(dto);

      expect(result.name).toBe('Turma do Discord');
      expect(result.maxUses).toBe(10);
      expect(result.token).toHaveLength(32);
      expect(result.status).toBe('Active');
      expect(result.joinUrl).toContain(`/join?token=${result.token}`);
      expect(mockInviteGroupRepo.save).toHaveBeenCalledTimes(1);
      expect(mockInviteServerRepo.save).toHaveBeenCalledTimes(1);
    });

    it('deve registrar o nickname do administrador que emitiu o convite', async () => {
      const result = await service.createInvite({ name: 'Turma do Discord' }, 'AdminSteve');

      expect(mockInviteRepo.create).toHaveBeenCalledWith(expect.objectContaining({ created_by: 'AdminSteve' }));
      expect(result.createdBy).toBe('AdminSteve');
    });
  });

  describe('validateToken: dados para a tela /join', () => {
    it('deve devolver os nomes dos servidores e quem convidou, sem expor dados além do resumo', async () => {
      mockInviteRepo.findOne.mockResolvedValueOnce({
        id: 'inv-1',
        token: 'tok',
        name: 'Turma',
        max_uses: 5,
        used_count: 0,
        expires_at: new Date(Date.now() + 100000),
        is_active: true,
        created_by: 'AdminSteve',
        created_at: new Date(),
        invite_groups: [],
        invite_servers: [{ server_id: 'srv-1' }, { server_id: 'srv-2' }],
      });
      mockServerRepo.find.mockResolvedValueOnce([
        { id: 'srv-1', name: 'Survival', rcon_password: 'segredo' },
        { id: 'srv-2', name: 'Creative' },
      ]);

      const result = await service.validateToken('tok');

      expect(result.serverNames).toEqual(['Survival', 'Creative']);
      expect(result.createdBy).toBe('AdminSteve');
      expect(JSON.stringify(result)).not.toContain('segredo');
    });

    it('não consulta servidores quando o convite não tem nenhum vinculado', async () => {
      mockInviteRepo.findOne.mockResolvedValueOnce({
        id: 'inv-1',
        token: 'tok',
        name: 'Turma',
        max_uses: 5,
        used_count: 0,
        expires_at: new Date(Date.now() + 100000),
        is_active: true,
        created_by: null,
        created_at: new Date(),
        invite_groups: [],
        invite_servers: [],
      });

      const result = await service.validateToken('tok');

      expect(result.serverNames).toEqual([]);
      expect(mockServerRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('validateToken (RF-TS-08)', () => {
    it('deve falhar se token não existir no banco', async () => {
      mockInviteRepo.findOne.mockResolvedValue(null);
      await expect(service.validateToken('invalid-token')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve rejeitar token revogado', async () => {
      mockInviteRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        is_active: false,
        used_count: 0,
        max_uses: 5,
        expires_at: new Date(Date.now() + 100000),
      });

      await expect(service.validateToken('revoked-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve rejeitar token esgotado (Depleted)', async () => {
      mockInviteRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        is_active: true,
        used_count: 5,
        max_uses: 5,
        expires_at: new Date(Date.now() + 100000),
      });

      await expect(service.validateToken('depleted-token')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('claimInvite com Concorrência e Compensação L-03 (RF-TS-08, Critério de Aceite)', () => {
    it('deve rejeitar nicknames com caracteres inválidos ou espaços (< 50ms)', async () => {
      await expect(
        service.claimInvite({
          token: 'token-valid-12345678',
          realName: 'Lucas',
          minecraftNick: 'Invalid Nick',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.claimInvite({
          token: 'token-valid-12345678',
          realName: 'Lucas',
          minecraftNick: 'A', // muito curto
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('10 claims simultâneos em maxUses=1 → exatamente 1 sucesso e 9 conflitos (Critério de Aceite)', async () => {
      const inviteToken = 'token-atomic-test-12345678';
      let remainingQuota = 1;

      // Simula atomicidade no banco com QueryBuilder update condicional
      const createMockQb = () => {
        const qb: any = {
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          execute: jest.fn().mockImplementation(async () => {
            if (remainingQuota > 0) {
              remainingQuota--;
              return { affected: 1 };
            }
            return { affected: 0 };
          }),
        };
        return qb;
      };

      mockInviteRepo.createQueryBuilder.mockImplementation(createMockQb);
      mockInviteRepo.findOne.mockResolvedValue({
        id: 'inv-atomic-1',
        token: inviteToken,
        name: 'Atomic Invite',
        is_active: true,
        used_count: 1,
        max_uses: 1,
        expires_at: new Date(Date.now() + 100000),
        invite_groups: [],
        invite_servers: [],
      });

      const promises = Array.from({ length: 10 }).map((_, index) =>
        service
          .claimInvite({
            token: inviteToken,
            realName: `Player_${index}`,
            minecraftNick: `Nick_${index}`,
          })
          .then((res) => ({ status: 'fulfilled', value: res }))
          .catch((err) => ({ status: 'rejected', reason: err })),
      );

      const results = await Promise.all(promises);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(9);
      for (const rej of rejected) {
        expect((rej as any).reason).toBeInstanceOf(ConflictException);
      }
    });

    it('deve abortar e compensar cota se nickname já estiver registrado por outro jogador', async () => {
      const inviteToken = 'token-nick-conflict-12345678';

      const compensationQb: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockInviteRepo.createQueryBuilder.mockReturnValue(compensationQb);

      mockInviteRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        token: inviteToken,
        is_active: true,
        used_count: 0,
        max_uses: 5,
        expires_at: new Date(Date.now() + 100000),
        invite_groups: [],
        invite_servers: [],
      });

      // Simula que o nickname já existe no banco de dados
      mockUserRepo.findOne.mockResolvedValue({
        id: 'other-user-uuid',
        minecraft_nick: 'LucasCraft',
      });

      await expect(
        service.claimInvite({
          token: inviteToken,
          realName: 'Impostor',
          minecraftNick: 'LucasCraft',
        }),
      ).rejects.toThrow(ConflictException);

      // Verifica se a compensação foi executada (decrementou used_count)
      expect(compensationQb.update).toHaveBeenCalled();
    });

    it('⚠️ L-03 Compensação: deve devolver cota e desfaz cadastro de usuário quando a Tailscale Cloud API falhar', async () => {
      const inviteToken = 'token-cloud-fail-12345678';

      const compensationQb: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockInviteRepo.createQueryBuilder.mockReturnValue(compensationQb);

      mockInviteRepo.findOne.mockResolvedValue({
        id: 'inv-fail-1',
        token: inviteToken,
        is_active: true,
        used_count: 0,
        max_uses: 5,
        expires_at: new Date(Date.now() + 100000),
        invite_groups: [],
        invite_servers: [],
      });

      mockUserRepo.findOne.mockResolvedValue(null);

      // Simula falha na API Cloud da Tailscale (HTTP 500 ou Timeout)
      mockTailscaleCloudDriver.generatePreAuthKey.mockRejectedValue(
        new Error('Tailscale Cloud API 500 Internal Server Error'),
      );

      await expect(
        service.claimInvite({
          token: inviteToken,
          realName: 'Lucas',
          minecraftNick: 'LucasCraft',
        }),
      ).rejects.toThrow(BadGatewayException);

      // Verifica se o rollback SAGA compensou o used_count e excluiu o usuário criado
      expect(compensationQb.update).toHaveBeenCalled();
      expect(mockUserRepo.delete).toHaveBeenCalledWith({ id: 'user-uuid-1' });
    });

    it('deve realizar resgate completo com sucesso na ausência de falhas', async () => {
      const inviteToken = 'token-success-12345678';

      const qb: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockInviteRepo.createQueryBuilder.mockReturnValue(qb);

      mockInviteRepo.findOne.mockResolvedValue({
        id: 'inv-ok-1',
        token: inviteToken,
        name: 'VIP Amigos',
        is_active: true,
        used_count: 0,
        max_uses: 5,
        expires_at: new Date(Date.now() + 100000),
        invite_groups: [{ group_id: 'grp-vip' }],
        invite_servers: [{ server_id: 'srv-survival' }],
      });

      mockUserRepo.findOne.mockResolvedValue(null);

      const result = await service.claimInvite({
        token: inviteToken,
        realName: 'Lucas Henrique',
        minecraftNick: 'LucasCraft',
      });

      expect(result.minecraftNick).toBe('LucasCraft');
      expect(result.authKey).toBe('tskey-auth-mock-12345');
      expect(result.deepLinkUrl).toContain('tailscale://login?key=tskey-auth-mock-12345');
      expect(mockUserGroupRepo.save).toHaveBeenCalledTimes(1);
      expect(mockUserServerAccessRepo.save).toHaveBeenCalledTimes(1);
      expect(mockDeviceRepo.save).toHaveBeenCalledTimes(1);
    });
  });
});
