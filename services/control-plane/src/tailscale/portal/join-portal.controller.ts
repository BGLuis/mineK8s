import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/public.decorator';
import { InvitesService } from '../invites/invites.service';
import { renderJoinPage } from './join-portal.template';

@ApiTags('Tailscale Onboarding Portal')
@Controller('join')
export class JoinPortalController {
  constructor(private readonly invitesService: InvitesService) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({
    summary: 'Renderiza a página SSR do portal /join para onboarding de novos jogadores (RF-TS-08, PR-10)',
  })
  @ApiQuery({
    name: 'token',
    required: false,
    type: String,
    description: 'Token criptográfico do convite recebido pelo link',
  })
  async renderPortal(@Query('token') token?: string): Promise<string> {
    if (!token) {
      return renderJoinPage(
        undefined,
        'Nenhum token de convite foi informado na URL. Solicite o link completo de acesso ao administrador.',
      );
    }

    try {
      const summary = await this.invitesService.validateToken(token);
      return renderJoinPage(summary);
    } catch (err: any) {
      return renderJoinPage(
        undefined,
        err.message || 'Convite inválido, esgotado ou expirado.',
      );
    }
  }
}
