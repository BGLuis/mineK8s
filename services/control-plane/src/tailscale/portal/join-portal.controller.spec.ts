import { JoinPortalController } from './join-portal.controller';

describe('JoinPortalController', () => {
  let controller: JoinPortalController;
  let mockInvitesService: any;

  beforeEach(() => {
    mockInvitesService = {
      validateToken: jest.fn(async (token: string) => ({
        id: 'inv-1',
        token,
        name: 'Turma do Discord',
        maxUses: 5,
        usedCount: 2,
        expiresAt: new Date(Date.now() + 86400000),
        status: 'Active',
      })),
    };

    controller = new JoinPortalController(mockInvitesService);
  });

  it('deve exibir mensagem de erro se nenhum token for informado na URL', async () => {
    const html = await controller.renderPortal(undefined);
    expect(html).toContain('Nenhum token de convite foi informado');
    expect(mockInvitesService.validateToken).not.toHaveBeenCalled();
  });

  it('deve renderizar formulário de resgate quando o token for válido e ativo', async () => {
    const html = await controller.renderPortal('valid-token-12345678');
    expect(html).toContain('Turma do Discord');
    expect(html).toContain('id="claimForm"');
    expect(html).toContain('valid-token-12345678');
    expect(mockInvitesService.validateToken).toHaveBeenCalledWith('valid-token-12345678');
  });

  it('deve exibir cartão de erro amigável quando o convite estiver esgotado ou expirado', async () => {
    mockInvitesService.validateToken.mockRejectedValue(
      new Error('O limite de utilizações deste convite foi atingido'),
    );

    const html = await controller.renderPortal('depleted-token');
    expect(html).toContain('Convite Inválido ou Esgotado');
    expect(html).toContain('O limite de utilizações deste convite foi atingido');
  });
});
