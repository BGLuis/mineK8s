import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/roles.decorator';

import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsService } from './settings.service';
import { SettingsSnapshot } from './settings.types';

@ApiTags('Settings')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Listar as configurações com o valor efetivo e sua origem (banco, ambiente ou padrão). Segredos nunca são devolvidos.',
  })
  @ApiResponse({ status: 200, description: 'Seções, configurações e diagnóstico somente leitura' })
  get(): SettingsSnapshot {
    return this.settings.snapshot();
  }

  @Patch()
  @ApiOperation({
    summary: 'Alterar configurações (tudo ou nada); null devolve a configuração ao ambiente/padrão',
  })
  @ApiResponse({ status: 200, description: 'Configurações após a alteração' })
  @ApiResponse({ status: 400, description: 'Algum valor é inválido; nada foi gravado' })
  update(
    @Body() dto: UpdateSettingsDto,
    @Req() req: { user?: { minecraft_nick?: string } },
  ): Promise<SettingsSnapshot> {
    return this.settings.update(dto.values, req.user?.minecraft_nick ?? null);
  }
}
