import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { SharesService } from './shares.service';

describe('SharesService: jogadores que recebem o nó compartilhado', () => {
  let service: SharesService;
  let users: any[];
  let userRepo: any;
  let groupRepo: any;
  let serverRepo: any;
  let userGroupRepo: any;
  let userServerRepo: any;
  let gatewayIpc: { revokePlayerSession: jest.Mock };

  beforeEach(() => {
    users = [];
    userRepo = {
      findOne: jest.fn(
        async ({ where }: any) =>
          users.find(
            (u) =>
              (where.email && u.email === where.email) ||
              (where.minecraft_nick && u.minecraft_nick === where.minecraft_nick) ||
              (where.id && u.id === where.id),
          ) ?? null,
      ),
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn(async (u) => {
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
    userGroupRepo = { create: jest.fn((d) => d), save: jest.fn(async (d) => d) };
    userServerRepo = { create: jest.fn((d) => d), save: jest.fn(async (d) => d) };
    gatewayIpc = {
      revokePlayerSession: jest.fn(async () => ({ terminated_connections_count: 1 })),
    };

    service = new SharesService(
      userRepo,
      groupRepo,
      serverRepo,
      userGroupRepo,
      userServerRepo,
      gatewayIpc as any,
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
});
