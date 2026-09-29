import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AppConfigService } from './config/app-config.service';

@ApiTags('System')
@Controller()
export class AppController {
  constructor(private readonly configService: AppConfigService) {}

  @Get('healthz')
  @ApiOperation({ summary: 'Liveness probe and system health check' })
  @ApiResponse({ status: 200, description: 'System is healthy' })
  healthz() {
    return {
      status: 'ok',
      service: 'control-plane',
      env: this.configService.nodeEnv,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
