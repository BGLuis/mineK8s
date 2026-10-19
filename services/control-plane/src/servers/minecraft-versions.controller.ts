import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '@auth/roles.decorator';
import { MinecraftVersionItem, MinecraftVersionsService } from './minecraft-versions.service';

@ApiTags('Minecraft')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('api/minecraft')
export class MinecraftVersionsController {
  constructor(private readonly versionsService: MinecraftVersionsService) {}

  @Get('versions')
  @ApiOperation({
    summary:
      'Listar versões do Minecraft por tipo de servidor, com filtro de snapshots (RF-STO-14)',
  })
  @ApiQuery({
    name: 'type',
    required: true,
    description: 'Tipo do servidor (VANILLA, PAPER, PURPUR, FABRIC, NEOFORGE, FORGE)',
  })
  @ApiQuery({
    name: 'snapshots',
    required: false,
    type: Boolean,
    description: 'Se deve incluir snapshots e versões de teste',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de versões ordenadas da mais nova para a mais antiga',
  })
  @ApiResponse({ status: 400, description: 'Tipo de servidor ausente ou desconhecido' })
  async getVersions(
    @Query('type') type?: string,
    @Query('snapshots') snapshots?: string | boolean,
  ): Promise<MinecraftVersionItem[]> {
    if (!type) {
      throw new BadRequestException('Query parameter "type" is required');
    }
    const includeSnapshots = snapshots === true || snapshots === 'true';
    return this.versionsService.listVersions(type, includeSnapshots);
  }
}
