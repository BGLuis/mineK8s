import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../auth/roles.decorator';
import { LinkSharedPlayerDto } from './link-shared-player.dto';
import { RegisterSharedPlayerDto } from './register-shared-player.dto';
import { SharedPlayerSummary, SharesService } from './shares.service';
import { UnlinkedAttempt } from './unlinked-attempts.service';

@ApiTags('Tailscale & Network Posture')
@Controller('api/tailscale/shares')
export class SharesController {
  constructor(private readonly sharesService: SharesService) {}

  @Get('unlinked-attempts')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Listar tentativas recentes de conexão de jogadores ainda não vinculados',
  })
  @ApiResponse({ status: 200 })
  listUnlinkedAttempts(): UnlinkedAttempt[] {
    return this.sharesService.listUnlinkedAttempts();
  }

  @Post('link')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Vincular uma tentativa de conexão recente a um jogador cadastrado (vínculo em 1 clique)',
  })
  @ApiResponse({ status: 200 })
  linkAttempt(@Body() dto: LinkSharedPlayerDto): Promise<SharedPlayerSummary> {
    return this.sharesService.linkAttempt(dto);
  }

  @Delete('unlinked-attempts/:tailscaleUserId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Dispensar uma tentativa não vinculada da lista' })
  @ApiResponse({ status: 204 })
  dismissUnlinkedAttempt(@Param('tailscaleUserId') tailscaleUserId: string): void {
    this.sharesService.dismissUnlinkedAttempt(tailscaleUserId);
  }

  @Post()
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Cadastrar quem vai receber o nó compartilhado do Gateway pelo Tailscale',
    description:
      'Depois do cadastro, compartilhe o nó do Gateway com o e-mail ou GitHub no console do Tailscale. ' +
      'No primeiro acesso, a conta Tailscale é ligada ao cadastro automaticamente.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 409, description: 'E-mail, GitHub ou nickname já cadastrados' })
  register(@Body() dto: RegisterSharedPlayerDto): Promise<SharedPlayerSummary> {
    return this.sharesService.register(dto);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Remover o jogador e derrubar as sessões abertas dele' })
  @ApiResponse({ status: 204 })
  remove(@Param('userId') userId: string): Promise<void> {
    return this.sharesService.remove(userId);
  }
}
