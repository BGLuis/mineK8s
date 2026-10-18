import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { SharesService } from './shares.service';
import { UnlinkedAttemptsService } from './unlinked-attempts.service';

describe('SharesService: jogadores que recebem o nó compartilhado', () => {
  let service: SharesService;
  let unlinkedAttempts: UnlinkedAttemptsService;
  let users: any[];
  let userRepo: any;
  let groupRepo: any;
  let serverRepo: any;
  let userGroupRepo: any;
  let userServerRepo: any;
  let gatewayIpc: { revokePlayerSession: jest.Mock };
  let appConfig: { tailscale: { nodeSharingEnabled: boolean } };

  beforeEach(() => {
    users = [];
    userRepo = {
      findOne: jest.fn(async ({ where }: any) => {
        const matches = (cond: any, u: any) =>
          Boolean(
            (cond.email && u.email === cond.email) ||
              (cond.github_username && u.github_username === cond.github_username) ||
              (cond.minecraft_nick && u.minecraft_nick === cond.minecraft_nick) ||
              (cond.tailscale_user_id && u.tailscale_user_id === cond.tailscale_user_id) ||
              (cond.id && u.id === cond.id),
          );
        if (Array.isArray(where)) {
          return users.find((u) => where.some((cond) => matches(cond, u))) ?? null;
        }
        return users.find((u) => matches(where, u)) ?? null;
      }),
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn(async (u) => {
        const existingIdx = users.findIndex((x) => x.id === u.id);
        if (existingIdx >= 0) {
          users[existingIdx] = { ...users[existingIdx], ...u };
          return users[existingIdx];
        }
        const saved = { id: 'user-new', ...u };
        users.push(saved);
        return saved;
      }),
      remove: jest.fn(async (u) => {
        users = users.filter((x) => x.id !== u.id);
        return u;
      }),
    };
    groupRepo = {
      find: jest.fn(async ({ where }: any) => where.id._value.map((id: string) => ({ id }))),
    };
    serverRepo = {
      find: jest.fn(async ({ where }: any) => where.id._value.map((id: string) => ({ id }))),
    };
    userGroupRepo = {
      create: jest.fn((d) => d),
      save: jest.fn(async (d) => d),
      find: jest.fn(async ({ where }: any) => [{ user_id: where.user_id, group_id: 'g1' }]),
    };
    userServerRepo = {
      create: jest.fn((d) => d),
      save: jest.fn(async (d) => d),
      find: jest.fn(async ({ where }: any) => [{ user_id: where.user_id, server_id: 's1' }]),
    };
    gatewayIpc = {
      revokePlayerSession: jest.fn(async () => ({ terminated_connections_count: 1 })),
    };

    appConfig = { tailscale: { nodeSharingEnabled: true } };
    unlinkedAttempts = new UnlinkedAttemptsService();
    service = new SharesService(
      userRepo,
      groupRepo,
      serverRepo,
      userGroupRepo,
      userServerRepo,
      gatewayIpc as any,
      appConfig as any,
      unlinkedAttempts,
    );
  });

  const input = {
    email: 'Amigo@Example.com',
    minecraftNick: 'AmigoCraft',
    realName: 'Amigo',
    groupIds: ['g1'],
    serverIds: ['s1'],
  };

  it('cadastra o jogador pelo e-mail do Tailscale, em minúsculas, ainda sem vínculo', async () => {
    const result = await service.register(input);

    expect(userRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'amigo@example.com',
        minecraft_nick: 'AmigoCraft',
        role: 'PLAYER',
      }),
    );
    expect(result).toMatchObject({ id: 'user-new', email: 'amigo@example.com', linked: false });
  });

  it('já deixa o jogador nos grupos e nos mundos pedidos', async () => {
    await service.register(input);

    expect(userGroupRepo.save).toHaveBeenCalledWith({ user_id: 'user-new', group_id: 'g1' });
    expect(userServerRepo.save).toHaveBeenCalledWith({ user_id: 'user-new', server_id: 's1' });
  });

  it('com o compartilhamento de nó desativado nas configurações, não cadastra ninguém', async () => {
    appConfig.tailscale.nodeSharingEnabled = false;

    await expect(service.register(input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('recusa um nickname fora do padrão do Minecraft', async () => {
    await expect(
      service.register({ ...input, minecraftNick: 'com espaço' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('não cadastra o mesmo e-mail nem o mesmo nickname duas vezes', async () => {
    await service.register(input);

    await expect(service.register({ ...input, minecraftNick: 'Outro' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.register({ ...input, email: 'outro@example.com' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('não cria o jogador quando um grupo pedido não existe', async () => {
    groupRepo.find.mockResolvedValue([]);

    await expect(service.register(input)).rejects.toBeInstanceOf(NotFoundException);
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('remover derruba as sessões abertas do jogador antes de apagá-lo', async () => {
    users.push({ id: 'u1', role: 'PLAYER', minecraft_nick: 'AmigoCraft' });

    await service.remove('u1');

    expect(gatewayIpc.revokePlayerSession).toHaveBeenCalledWith(
      expect.objectContaining({ minecraft_nick: 'AmigoCraft', server_id: '' }),
    );
    expect(users).toHaveLength(0);
  });

  it('nunca remove um administrador por aqui', async () => {
    users.push({ id: 'a1', role: 'ADMIN', minecraft_nick: 'Dono' });

    await expect(service.remove('a1')).rejects.toBeInstanceOf(ConflictException);
    expect(users).toHaveLength(1);
  });

  describe('Suporte a GitHub SSO e vínculo de tentativas', () => {
    it('cadastra jogador apenas com usuário do GitHub, sem e-mail, normalizando @ e sufixos', async () => {
      const result = await service.register({
        minecraftNick: 'JaoCraft',
        realName: 'Joao',
        github: '@jaoppb',
        groupIds: [],
        serverIds: [],
      });

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: null,
          github_username: 'jaoppb',
          minecraft_nick: 'JaoCraft',
        }),
      );
      expect(result.githubUsername).toBe('jaoppb');
      expect(result.email).toBeNull();
    });

    it('cadastra jogador com ambos: e-mail e usuário do GitHub', async () => {
      const result = await service.register({
        email: 'joao@example.com',
        github: 'jaoppb@github',
        minecraftNick: 'JaoCraft2',
        groupIds: [],
        serverIds: [],
      });

      expect(result.email).toBe('joao@example.com');
      expect(result.githubUsername).toBe('jaoppb');
    });

    it('rejeita cadastro quando nem e-mail nem GitHub foram informados', async () => {
      await expect(
        service.register({
          minecraftNick: 'SemNada',
          groupIds: [],
          serverIds: [],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita cadastro quando o usuário do GitHub contém caracteres inválidos', async () => {
      await expect(
        service.register({
          minecraftNick: 'Invalido',
          github: 'user/with/slashes',
          groupIds: [],
          serverIds: [],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lista e dispensa tentativas de conexão não vinculadas', () => {
      unlinkedAttempts.record({
        tailscaleUserId: 'ts-123',
        loginName: 'jaoppb@github',
        displayName: 'Joao Pedro',
        clientIp: '100.64.0.5',
        nodeId: 'node-1',
        nodeName: 'desktop',
        minecraftNick: 'JaoNick',
      });

      const list = service.listUnlinkedAttempts();
      expect(list).toHaveLength(1);
      expect(list[0].loginName).toBe('jaoppb@github');

      service.dismissUnlinkedAttempt('ts-123');
      expect(service.listUnlinkedAttempts()).toHaveLength(0);
    });

    it('vincula tentativa a um jogador existente com linkAttempt', async () => {
      users.push({
        id: 'user-alvo',
        minecraft_nick: 'JaoAlvo',
        email: 'joao@example.com',
        github_username: null,
        tailscale_user_id: null,
      });

      unlinkedAttempts.record({
        tailscaleUserId: 'ts-999',
        loginName: 'jaoppb@github',
        displayName: 'Joao Pedro',
        clientIp: '100.64.0.9',
        nodeId: 'node-9',
        nodeName: 'laptop',
        minecraftNick: 'JaoAlvo',
      });

      const linked = await service.linkAttempt({
        userId: 'user-alvo',
        tailscaleUserId: 'ts-999',
        githubUsername: 'jaoppb',
      });

      expect(linked.linked).toBe(true);
      expect(linked.githubUsername).toBe('jaoppb');
      expect(service.listUnlinkedAttempts()).toHaveLength(0);
      const userInDb = users.find((u) => u.id === 'user-alvo');
      expect(userInDb.tailscale_user_id).toBe('ts-999');
      expect(userInDb.github_username).toBe('jaoppb');
    });

    it('linkAttempt recusa vincular jogador que já tem outra conta Tailscale vinculada', async () => {
      users.push({
        id: 'user-outro',
        minecraft_nick: 'Outro',
        tailscale_user_id: 'ts-outro',
      });

      await expect(
        service.linkAttempt({
          userId: 'user-outro',
          tailscaleUserId: 'ts-999',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
