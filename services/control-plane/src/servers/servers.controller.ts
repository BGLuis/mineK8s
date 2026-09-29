import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '@auth/roles.decorator';
import { UserRole } from '@database/entities/user.entity';

import { ServersService } from './servers.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';
import { CommandDto } from './dto/command.dto';

@ApiTags('Servers & Kubernetes Orchestration')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('api/servers')
export class ServersController {
  constructor(private readonly serversService: ServersService) {}

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create and provision a new game server in Kubernetes' })
  @ApiResponse({ status: 201, description: 'Server provisioning initiated' })
  @ApiResponse({ status: 400, description: 'Invalid configuration parameters' })
  @ApiResponse({ status: 409, description: 'Subdomain already registered' })
  async create(@Body() dto: CreateServerDto) {
    return this.serversService.create(dto);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create and provision a new game server (REST alternative to /create)' })
  @ApiResponse({ status: 201, description: 'Server provisioning initiated' })
  async createDirect(@Body() dto: CreateServerDto) {
    return this.serversService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all managed game servers and real-time pod/deployment status' })
  @ApiResponse({ status: 200, description: 'List of servers' })
  async findAll() {
    return this.serversService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details and configuration of a specific game server' })
  @ApiResponse({ status: 200, description: 'Server details' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async findOne(@Param('id') id: string) {
    return this.serversService.findOne(id);
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Start a server (scale Kubernetes deployment replicas to 1)' })
  @ApiResponse({ status: 200, description: 'Server start initiated' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async start(@Param('id') id: string) {
    return this.serversService.start(id);
  }

  @Post(':id/stop')
  @ApiOperation({ summary: 'Stop a server (scale Kubernetes deployment replicas to 0)' })
  @ApiResponse({ status: 200, description: 'Server stop initiated' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async stop(@Param('id') id: string) {
    return this.serversService.stop(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a server and deprovision Kubernetes resources' })
  @ApiResponse({ status: 200, description: 'Server deleted and resources deprovisioned' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async delete(@Param('id') id: string) {
    return this.serversService.delete(id);
  }

  @Patch(':id/domain')
  @ApiOperation({ summary: 'Update server subdomain/domain mapping' })
  @ApiResponse({ status: 200, description: 'Domain updated successfully' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  @ApiResponse({ status: 409, description: 'Domain already in use' })
  async updateDomain(@Param('id') id: string, @Body() dto: UpdateDomainDto) {
    return this.serversService.updateDomain(id, dto.domain);
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'Get recent server container logs' })
  @ApiResponse({ status: 200, description: 'Log buffer output' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async getLogs(@Param('id') id: string, @Query('tail') tail?: number) {
    return this.serversService.getLogs(id, tail ? Number(tail) : 150);
  }

  @Post(':id/command')
  @ApiOperation({ summary: 'Dispatch command to server via RCON or console driver' })
  @ApiResponse({ status: 200, description: 'Command response' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async sendCommand(@Param('id') id: string, @Body() dto: CommandDto) {
    return this.serversService.sendCommand(id, dto.command);
  }
}
