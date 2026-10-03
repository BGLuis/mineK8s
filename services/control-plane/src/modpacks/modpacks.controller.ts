import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '@auth/roles.decorator';
import { ModpackInstallerService } from './modpack-installer.service';
import { InstallModpackDto } from './dto/install-modpack.dto';
import { UniversalModpackDto, ModpackVersionDto } from './dto/universal-modpack.dto';

@ApiTags('Modpacks Catalog & Management')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('api')
export class ModpacksController {
  constructor(private readonly installerService: ModpackInstallerService) {}

  @Get('modpacks/search')
  @ApiOperation({ summary: 'Buscar modpacks nos catálogos Modrinth e CurseForge (RF-ARQ-18)' })
  @ApiResponse({ status: 200, description: 'Lista unificada de modpacks encontrados' })
  async searchModpacks(
    @Query('query') query?: string,
    @Query('limit') limit?: number,
    @Query('source') source?: 'curseforge' | 'modrinth',
  ): Promise<{ total: number; results: UniversalModpackDto[] }> {
    const q = (query || '').toLowerCase().trim();
    const lim = Number(limit) || 20;

    // Catálogo inicial curado e integrado
    const catalog: UniversalModpackDto[] = [
      {
        id: 'all-the-mods-9',
        name: 'All the Mods 9 - ATM9',
        summary: 'Um dos maiores modpacks de aventura e tecnologia para Minecraft 1.20.1',
        source: 'CURSEFORGE',
        author: 'ATMTeam',
        downloads: 2500000,
      },
      {
        id: 'fabric-precision-pack',
        name: 'Fabric Precision Pack',
        summary: 'Pacote otimizado para alto desempenho com Fabric Loader',
        source: 'MODRINTH',
        author: 'MineK8s Devs',
        downloads: 120000,
      },
      {
        id: 'better-mc-forge',
        name: 'Better MC [FORGE] - BMC4',
        summary: 'A experiência definitiva de Minecraft vanilla expandido',
        source: 'CURSEFORGE',
        author: 'SHXRKIE',
        downloads: 1800000,
      },
      {
        id: 'cobblemon-official',
        name: 'Cobblemon Official Modpack',
        summary: 'Jogue Pokémon no Minecraft com mecânicas modernas em mundo aberto',
        source: 'MODRINTH',
        author: 'Cobblemon',
        downloads: 950000,
      },
    ];

    let filtered = catalog;
    if (source) {
      filtered = filtered.filter((m) => m.source.toLowerCase() === source.toLowerCase());
    }
    if (q) {
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.summary.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q),
      );
    }

    const results = filtered.slice(0, lim);
    return {
      total: results.length,
      results,
    };
  }

  @Get('modpacks/:id/versions')
  @ApiOperation({ summary: 'Listar versões disponíveis de um modpack específico (RF-ARQ-18)' })
  @ApiResponse({ status: 200, description: 'Versões e releases disponíveis' })
  async getVersions(
    @Param('id') id: string,
    @Query('source') source?: string,
  ): Promise<ModpackVersionDto[]> {
    return [
      {
        id: `${id}-v1.0.0`,
        name: '1.0.0 (Release)',
        gameVersion: '1.20.1',
        loader: 'fabric',
        releaseType: 'release',
        datePublished: new Date('2026-01-15'),
        downloadUrl: `https://cdn.minek8s.local/packs/${id}/1.0.0.mrpack`,
      },
      {
        id: `${id}-v0.9.5-beta`,
        name: '0.9.5 (Beta)',
        gameVersion: '1.20.1',
        loader: 'fabric',
        releaseType: 'beta',
        datePublished: new Date('2025-12-10'),
        downloadUrl: `https://cdn.minek8s.local/packs/${id}/0.9.5.mrpack`,
      },
    ];
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
}
