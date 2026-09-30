import {
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

import { HealthBotSchedulerService } from './health-bot-scheduler.service';

@ApiTags('Health Bot E2E (RF-ARQ-30, Milestone F9)')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('api/health-bot')
export class HealthBotController {
  constructor(private readonly schedulerService: HealthBotSchedulerService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get global health bot status overview across all monitored servers' })
  @ApiResponse({ status: 200, description: 'Aggregated health metrics and status' })
  async getOverview() {
    return this.schedulerService.getOverview();
  }

  @Get('servers/:id/reports')
  @ApiOperation({ summary: 'Get historical synthetic health check reports for a specific server' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of reports to return (max 50, default 20)' })
  @ApiResponse({ status: 200, description: 'List of historical health bot reports' })
  async getReports(
    @Param('id') id: string,
    @Query('limit') limit?: number,
  ) {
    const parsedLimit = limit ? parseInt(limit.toString(), 10) : 20;
    return this.schedulerService.getReports(id, isNaN(parsedLimit) ? 20 : parsedLimit);
  }

  @Post('servers/:id/probe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger an immediate on-demand E2E synthetic health bot check' })
  @ApiResponse({ status: 200, description: 'Generated health bot report with latencies' })
  async triggerProbe(@Param('id') id: string) {
    return this.schedulerService.probeServer(id);
  }
}
