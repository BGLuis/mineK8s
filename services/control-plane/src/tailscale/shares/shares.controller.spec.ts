import { SharesController } from './shares.controller';

describe('SharesController', () => {
  const sharesService = {
    register: jest.fn(async () => ({ id: 'u1' })),
    remove: jest.fn(async () => undefined),
  };
  const controller = new SharesController(sharesService as any);

  it('delega o cadastro ao serviço', async () => {
    const dto = { email: 'a@b.com', minecraftNick: 'Abc' };

    await expect(controller.register(dto)).resolves.toEqual({ id: 'u1' });
    expect(sharesService.register).toHaveBeenCalledWith(dto);
  });

  it('delega a remoção ao serviço', async () => {
    await controller.remove('u1');

    expect(sharesService.remove).toHaveBeenCalledWith('u1');
  });
});
