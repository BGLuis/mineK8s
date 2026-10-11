import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../auth/roles.decorator';
import { RegisterSharedPlayerDto } from './register-shared-player.dto';
import { SharedPlayerSummary, SharesService } from './shares.service';

@ApiTags('Tailscale & Network Posture')
@Controller('api/tailscale/shares')
export class SharesController {
  constructor(private readonly sharesService: SharesService) {}

  @Post()
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Cadastrar quem vai receber o nó compartilhado do Gateway pelo Tailscale',
    description:
      'Depois do cadastro, compartilhe o nó do Gateway com o mesmo e-mail no console do Tailscale. ' +
      'No primeiro acesso, a conta Tailscale é ligada ao cadastro pelo e-mail do login.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 409, description: 'E-mail ou nickname já cadastrados' })
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
