import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '@auth/roles.decorator';

import { NodeMetricsDto } from './dto/node-metrics.dto';
import { NodeMetricsService } from './node-metrics.service';

@ApiTags('Node')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('api/node')
export class NodeController {
  constructor(private readonly metrics: NodeMetricsService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'CPU, RAM, disk and tailnet quota of the host, with disk alert levels' })
  @ApiResponse({ status: 200, type: NodeMetricsDto })
  async getMetrics(): Promise<NodeMetricsDto> {
    return this.metrics.getMetrics();
  }
}
