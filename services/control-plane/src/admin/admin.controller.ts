import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/roles.decorator';
import { AdminService } from './admin.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { SmartKickDto } from './dto/smart-kick.dto';
import { AccessibleServerDto, UserSummaryDto } from './dto/user-summary.dto';

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
