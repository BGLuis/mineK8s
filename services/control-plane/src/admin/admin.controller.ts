import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/roles.decorator';
import { AdminService } from './admin.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { SimulateAccessDto, SimulatedUserAccessResultDto } from './dto/simulate-access.dto';
import { SmartKickDto } from './dto/smart-kick.dto';
import { AccessibleServerDto, UserSummaryDto } from './dto/user-summary.dto';
import { AccessMatrixDto } from './dto/access-matrix.dto';
import { IdentityProbeDto, IdentityProbeResultDto } from './dto/identity-probe.dto';

@ApiTags('Admin & ACL Management')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('api/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'Listar usuários com papel, dispositivos e grupos' })
  @ApiResponse({ status: 200, type: [UserSummaryDto] })
  async listUsers(): Promise<UserSummaryDto[]> {
    return this.adminService.listUsers();
  }

  @Get('users/:id/servers')
  @ApiOperation({
    summary: 'Listar os servidores que o usuário pode acessar (base do diálogo de Expulsar)',
  })
  @ApiResponse({ status: 200, type: [AccessibleServerDto] })
  @ApiResponse({ status: 404, description: 'User not found' })
  async listAccessibleServers(@Param('id') id: string): Promise<AccessibleServerDto[]> {
    return this.adminService.listAccessibleServers(id);
  }

  @Get('users/:id/access')
  @ApiOperation({
    summary: 'Explicar detalhadamente o acesso do usuário a todos os servidores (#211)',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de mundos com avaliação de acesso e justificativa',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async explainUserAccess(@Param('id') id: string) {
    return this.adminService.explainUserAccess(id);
  }

  @Get('access/matrix')
  @ApiOperation({
    summary: 'Matriz consolidada de acesso de usuários a servidores (#214)',
  })
  @ApiResponse({
    status: 200,
    type: AccessMatrixDto,
    description: 'Matriz com usuários, servidores e células de permissão de acesso',
  })
  async getAccessMatrix(): Promise<AccessMatrixDto> {
    return this.adminService.getAccessMatrix();
  }

  @Post('access/identity-probe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sondagem dry-run de identidade por ID Tailscale ou IP (#215)',
  })
  @ApiResponse({
    status: 200,
    type: IdentityProbeResultDto,
    description: 'Resultado da sonda de identidade, WhoIs, anti-impersonação e mundos acessíveis',
  })
  async probeIdentity(@Body() dto: IdentityProbeDto): Promise<IdentityProbeResultDto> {
    return this.adminService.probeIdentity(dto);
  }

  @Post('users/:id/servers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Conceder acesso direto de servidor a um usuário (#212)',
  })
  @ApiResponse({ status: 200, description: 'Acesso concedido com sucesso' })
  @ApiResponse({ status: 404, description: 'User or server not found' })
  async grantServerToUser(
    @Param('id') id: string,
    @Body('serverId') serverId: string,
  ): Promise<{ success: boolean }> {
    await this.adminService.grantServerToUser(id, serverId);
    return { success: true };
  }

  @Delete('users/:id/servers/:serverId')
  @ApiOperation({
    summary: 'Revogar acesso direto de servidor do usuário com Smart Kick caso perca acesso (#212)',
  })
  @ApiResponse({ status: 200, description: 'Acesso revogado com sucesso' })
  @ApiResponse({ status: 404, description: 'User or server not found' })
  async revokeServerFromUser(
    @Param('id') id: string,
    @Param('serverId') serverId: string,
  ): Promise<{ kickedServers: string[] }> {
    return this.adminService.revokeServerFromUser(id, serverId);
  }

  @Post('groups')
  @ApiOperation({ summary: 'Criar novo grupo de acesso de jogadores (RF-ARQ-20)' })
  @ApiResponse({ status: 201, description: 'Grupo criado com sucesso' })
  async createGroup(@Body() dto: CreateGroupDto) {
    return this.adminService.createGroup(dto);
  }

  @Get('groups')
  @ApiOperation({ summary: 'Listar todos os grupos de acesso' })
  @ApiResponse({ status: 200, description: 'Lista de grupos cadastrados' })
  async listGroups() {
    return this.adminService.listGroups();
  }

  @Delete('groups/:id')
  @ApiOperation({ summary: 'Excluir um grupo de acesso' })
  @ApiResponse({ status: 200, description: 'Grupo removido com sucesso' })
  async deleteGroup(@Param('id') id: string) {
    await this.adminService.deleteGroup(id);
    return { success: true };
  }

  @Post('groups/:id/users')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Associar jogador a um grupo de permissões' })
  @ApiResponse({ status: 200, description: 'Jogador associado ao grupo' })
  async addUserToGroup(@Param('id') groupId: string, @Body('userId') userId: string) {
    await this.adminService.addUserToGroup(groupId, userId);
    return { success: true };
  }

  @Delete('groups/:id/users/:userId')
  @ApiOperation({
    summary:
      'Remover jogador do grupo com disparo imediato de Smart Kick caso perca acesso a servidores ativos (RF-ARQ-20, RF-TS-09)',
  })
  @ApiResponse({ status: 200, description: 'Usuário removido e Smart Kick disparado' })
  async removeUserFromGroup(@Param('id') groupId: string, @Param('userId') userId: string) {
    return this.adminService.removeUserFromGroup(groupId, userId);
  }

  @Post('groups/:id/servers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Associar servidor a um grupo de acesso' })
  @ApiResponse({ status: 200, description: 'Servidor associado ao grupo' })
  async addServerToGroup(@Param('id') groupId: string, @Body('serverId') serverId: string) {
    await this.adminService.addServerToGroup(groupId, serverId);
    return { success: true };
  }

  @Delete('groups/:id/servers/:serverId')
  @ApiOperation({ summary: 'Desassociar servidor de um grupo de permissões' })
  @ApiResponse({ status: 200, description: 'Servidor desassociado do grupo' })
  async removeServerFromGroup(@Param('id') groupId: string, @Param('serverId') serverId: string) {
    await this.adminService.removeServerFromGroup(groupId, serverId);
    return { success: true };
  }

  @Post('access/simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Simular alterações de permissões e impactos antes de aplicar (#213)',
  })
  @ApiResponse({ status: 200, type: [SimulatedUserAccessResultDto] })
  async simulateAccess(@Body() dto: SimulateAccessDto): Promise<SimulatedUserAccessResultDto[]> {
    return this.adminService.simulateAccessChanges(dto);
  }

  @Post('smart-kick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Despachar Smart Kick manual para jogador em servidor ativo (RF-GW-15, RF-TS-09)',
  })
  @ApiResponse({ status: 200, description: 'Smart Kick executado com sucesso' })
  async smartKick(@Body() dto: SmartKickDto) {
    return this.adminService.smartKick(dto);
  }
}
