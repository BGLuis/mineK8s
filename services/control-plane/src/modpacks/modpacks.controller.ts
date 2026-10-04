import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '@auth/roles.decorator';
import { ModpackInstallerService } from './modpack-installer.service';
import { InstallModpackDto } from './dto/install-modpack.dto';
import { ModpackSearchResponseDto, ModpackVersionDto } from './dto/universal-modpack.dto';
import {
  CATALOG_LOADERS,
  CATALOG_SORTS,
  CatalogLoader,
  CatalogSort,
  CatalogSource,
  ModpackCatalogService,
} from './modpack-catalog.service';

const GAME_VERSION_PATTERN = /^\d+\.\d+(\.\d+)?(-[A-Za-z0-9.]+)?$/;
const CATEGORY_SLUG_PATTERN = /^[a-z0-9-]{1,50}$/;

@ApiTags('Modpacks Catalog & Management')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('api')
export class ModpacksController {
  constructor(
    private readonly installerService: ModpackInstallerService,
    private readonly catalogService: ModpackCatalogService,
  ) {}

  @Get('modpacks/search')
  @ApiOperation({ summary: 'Buscar modpacks nos catálogos Modrinth e CurseForge (RF-ARQ-18)' })
  @ApiQuery({ name: 'source', required: false, enum: ['modrinth', 'curseforge'] })
  @ApiQuery({ name: 'sort', required: false, enum: CATALOG_SORTS, description: 'Padrão: relevance' })
  @ApiQuery({ name: 'gameVersion', required: false, description: 'Versão do Minecraft, ex.: 1.20.1' })
  @ApiQuery({ name: 'loader', required: false, enum: CATALOG_LOADERS })
  @ApiQuery({ name: 'category', required: false, description: 'Slug da categoria, ex.: adventure' })
  @ApiResponse({ status: 200, type: ModpackSearchResponseDto })
  @ApiResponse({ status: 400, description: 'Parâmetro de ordenação ou filtro inválido' })
  @ApiResponse({ status: 502, description: 'Nenhum catálogo respondeu' })
  @ApiResponse({ status: 503, description: 'CurseForge solicitado sem CURSEFORGE_API_KEY' })
  async searchModpacks(
    @Query('query') query?: string,
    @Query('limit') limit?: number,
    @Query('source') source?: string,
    @Query('offset') offset?: number,
    @Query('sort') sort?: string,
    @Query('gameVersion') gameVersion?: string,
    @Query('loader') loader?: string,
    @Query('category') category?: string,
  ): Promise<ModpackSearchResponseDto> {
    return this.catalogService.search({
      query,
      limit,
      offset,
      source: this.parseSource(source),
      sort: this.parseOption<CatalogSort>('sort', sort, CATALOG_SORTS),
      loader: this.parseOption<CatalogLoader>('loader', loader, CATALOG_LOADERS),
      gameVersion: this.parsePattern('gameVersion', gameVersion, GAME_VERSION_PATTERN),
      category: this.parsePattern('category', category?.toLowerCase(), CATEGORY_SLUG_PATTERN),
    });
  }

  @Get('modpacks/:id/versions')
  @ApiOperation({ summary: 'Listar versões disponíveis de um modpack específico (RF-ARQ-18)' })
  @ApiQuery({ name: 'source', required: false, enum: ['modrinth', 'curseforge'] })
  @ApiResponse({ status: 200, description: 'Versões e releases disponíveis', type: [ModpackVersionDto] })
  @ApiResponse({ status: 502, description: 'Catálogo de origem não respondeu' })
  async getVersions(
    @Param('id') id: string,
    @Query('source') source?: string,
  ): Promise<ModpackVersionDto[]> {
    return this.catalogService.getVersions(id, this.parseSource(source));
  }

  @Post('servers/:id/modpack/install')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Instalar ou atualizar modpack em uma instância de servidor (RF-STO-11, RF-STO-12)' })
  @ApiResponse({ status: 202, description: 'Instalação iniciada em segundo plano' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  @ApiResponse({ status: 409, description: 'Servidor em execução (requer estado STOPPED)' })
  async installModpack(
    @Param('id') id: string,
    @Body() dto: InstallModpackDto,
  ) {
    return this.installerService.installModpack(id, dto);
  }

  private parseSource(source?: string): CatalogSource | undefined {
    if (!source) return undefined;
    const normalized = source.toLowerCase();
    if (normalized !== 'modrinth' && normalized !== 'curseforge') {
      throw new BadRequestException(`source inválido: ${source}`);
    }
    return normalized;
  }

  private parseOption<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
    if (!value) return undefined;
    const normalized = value.toLowerCase() as T;
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(`${name} inválido: ${value}`);
    }
    return normalized;
  }

  private parsePattern(name: string, value: string | undefined, pattern: RegExp): string | undefined {
    if (!value) return undefined;
    if (!pattern.test(value)) {
      throw new BadRequestException(`${name} inválido: ${value}`);
    }
    return value;
  }
}
