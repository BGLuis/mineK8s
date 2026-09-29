import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '@auth/roles.decorator';

import { PostureAuditReport } from './posture/posture-audit.dto';
import { RawTailscalePolicy, TailscalePostureService } from './posture/tailscale-posture.service';

@ApiTags('Tailscale & Network Posture')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('api/tailscale')
export class TailscaleController {
  constructor(private readonly postureService: TailscalePostureService) {}

  @Get('posture-audit')
  @ApiOperation({
    summary: 'Obter relatório de auditoria de postura Zero-Trust da Tailnet (RF-TS-13)',
    description: 'Inspeciona regras de firewall da Tailnet para detectar vazamento de portas ou regras curinga permissivas.',
  })
  @ApiQuery({
    name: 'refresh',
    required: false,
    type: Boolean,
    description: 'Forçar reexecução da auditoria contra a Tailscale Cloud API',
  })
  @ApiResponse({ status: 200, type: PostureAuditReport })
  async getPostureAudit(@Query('refresh') refresh?: string): Promise<PostureAuditReport> {
    const forceRefresh = refresh === 'true' || refresh === '1';
    return this.postureService.getLatestAuditReport(forceRefresh);
  }

  @Post('posture-audit/evaluate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Avaliar hipoteticamente um schema de política huJSON (Simulação / Red Team)',
  })
  @ApiResponse({ status: 200, type: PostureAuditReport })
  async evaluateCustomPolicy(@Body() policy: RawTailscalePolicy): Promise<PostureAuditReport> {
    return this.postureService.evaluatePolicy(policy, 'memory', false);
  }
}
