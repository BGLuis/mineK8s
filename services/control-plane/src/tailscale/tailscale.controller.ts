import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';

import { PostureAuditReport } from './posture/posture-audit.dto';
import { RawTailscalePolicy, TailscalePostureService } from './posture/tailscale-posture.service';
import { InvitesService } from './invites/invites.service';
import { DevicesService } from './devices/devices.service';
import { CreateInviteDto, ClaimInviteDto, ClaimResultDto, InviteSummaryDto } from './dto';

@ApiTags('Tailscale & Network Posture')
@Controller('api/tailscale')
export class TailscaleController {
  constructor(
    private readonly postureService: TailscalePostureService,
    private readonly invitesService: InvitesService,
    private readonly devicesService: DevicesService,
  ) {}

  @Get('posture-audit')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Obter relatório de auditoria de postura Zero-Trust da Tailnet (RF-TS-13)',
    description:
      'Inspeciona regras de firewall da Tailnet para detectar vazamento de portas ou regras curinga permissivas.',
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
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Avaliar hipoteticamente um schema de política huJSON (Simulação / Red Team)',
  })
  @ApiResponse({ status: 200, type: PostureAuditReport })
  async evaluateCustomPolicy(@Body() policy: RawTailscalePolicy): Promise<PostureAuditReport> {
    return this.postureService.evaluatePolicy(policy, 'memory', false);
  }

  @Post('invites')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Criar um convite com cotas e permissões pré-vinculadas (RF-TS-03, RF-TS-11, RF-ARQ-19)',
  })
  @ApiResponse({ status: 201, type: InviteSummaryDto })
  async createInvite(@Body() dto: CreateInviteDto, @Req() req: any): Promise<InviteSummaryDto> {
    return this.invitesService.createInvite(dto, req.user?.minecraft_nick);
  }

  @Get('invites')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Listar todos os convites emitidos e seus status de ciclo de vida (RF-TS-06)',
  })
  @ApiResponse({ status: 200, type: [InviteSummaryDto] })
  async listInvites(): Promise<InviteSummaryDto[]> {
    return this.invitesService.listInvites();
  }

  @Get('invites/:id')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Obter detalhes de um convite específico por ID',
  })
  @ApiResponse({ status: 200, type: InviteSummaryDto })
  async getInviteById(@Param('id') id: string): Promise<InviteSummaryDto> {
    return this.invitesService.getInviteById(id);
  }

  @Delete('invites/:id')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Revogar explicitamente um convite (RF-TS-06: transição para Revoked)',
  })
  @ApiResponse({ status: 200, type: InviteSummaryDto })
  async revokeInvite(@Param('id') id: string): Promise<InviteSummaryDto> {
    return this.invitesService.revokeInvite(id);
  }

  @Public()
  @Get('invites/validate/:token')
  @ApiOperation({
    summary: 'Verificar se um token de convite está ativo e resgatável (Público para /join)',
  })
  @ApiResponse({ status: 200, type: InviteSummaryDto })
  async validateToken(@Param('token') token: string): Promise<InviteSummaryDto> {
    return this.invitesService.validateToken(token);
  }

  @Public()
  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Resgatar um convite no portal /join gerando AuthKey da Tailscale (RF-TS-08, ⚠️ L-03 Compensação)',
  })
  @ApiResponse({ status: 200, type: ClaimResultDto })
  async claimInvite(@Body() dto: ClaimInviteDto): Promise<ClaimResultDto> {
    return this.invitesService.claimInvite(dto);
  }

  // --- Gestão de Dispositivos e Nível 2 de Revogação (RF-TS-07, RF-TS-09, RF-TS-15) ---

  @Get('devices')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Listar todos os nós e dispositivos registrados na Tailnet (RF-TS-07)' })
  @ApiResponse({ status: 200, description: 'Lista de dispositivos' })
  async listDevices() {
    return this.devicesService.listDevices();
  }

  @Get('devices/:id')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Obter detalhes de um dispositivo por ID' })
  @ApiResponse({ status: 200, description: 'Detalhes do dispositivo' })
  async getDeviceById(@Param('id') id: string) {
    return this.devicesService.getDeviceById(id);
  }

  @Delete('devices/:id')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Nível 2 de Revogação: Ban de Rede Total, fechamento forçado de sessões e exclusão do nó na Tailnet (RF-TS-09)',
  })
  @ApiResponse({
    status: 200,
    description: 'Dispositivo banido da rede privada e removido da Tailnet',
  })
  async revokeDevice(@Param('id') id: string) {
    return this.devicesService.revokeDevice(id);
  }

  @Post('devices/gc')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'DeviceGarbageCollector: Limpar nós órfãos e inativos há mais de 30 dias (RF-TS-15, E-03)',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    type: Number,
    description: 'Threshold em dias (padrão: 30)',
  })
  @ApiResponse({ status: 200, description: 'Relatório de nós removidos da Tailnet' })
  async runDeviceGarbageCollector(@Query('days') days?: string) {
    const thresholdDays = days ? parseInt(days, 10) : 30;
    return this.devicesService.cleanInactiveDevices(thresholdDays);
  }
}
