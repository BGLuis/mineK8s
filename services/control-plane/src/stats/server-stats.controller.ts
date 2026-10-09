import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '@auth/roles.decorator';

import { ServerStatsDto } from './dto/server-stats.dto';
import { ServerStatsService } from './server-stats.service';

@ApiTags('Servers & Kubernetes Orchestration')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('api/servers')
export class ServerStatsController {
  constructor(private readonly stats: ServerStatsService) {}

  @Get(':id/stats')
  @ApiOperation({
    summary: 'TPS, MSPT and container memory of a running server, with up to 60 minutes of history',
  })
  @ApiQuery({ name: 'window', required: false, example: '60m' })
  @ApiResponse({ status: 200, description: 'Latest reading plus the series; empty when not READY' })
  @ApiResponse({ status: 400, description: 'Window outside 1m-60m' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async getStats(
    @Param('id') id: string,
    @Query('window') window?: string,
  ): Promise<ServerStatsDto> {
    return this.stats.getStats(id, window);
  }
}
