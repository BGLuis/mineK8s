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
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '@auth/roles.decorator';
import { UserRole } from '@database/entities/user.entity';

import { ServersService } from './servers.service';
import { ServersFilesService } from './servers-files.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';
import { CommandDto } from './dto/command.dto';
import { WriteFileDto } from './dto/write-file.dto';

@ApiTags('Servers & Kubernetes Orchestration')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('api/servers')
export class ServersController {
  constructor(
    private readonly serversService: ServersService,
    private readonly filesService: ServersFilesService,
  ) {}

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
  async sendCommand(
    @Param('id') id: string,
    @Body() dto: CommandDto,
    @Req() req?: any,
  ) {
    return this.serversService.sendCommand(id, dto.command, {
      user: req?.user,
      ipAddress: req?.ip || req?.connection?.remoteAddress,
      source: 'REST_API',
    });
  }

  @Get(':id/files')
  @ApiOperation({ summary: 'List files and directories inside server /data storage (RF-ARQ-17, L-04)' })
  @ApiResponse({ status: 200, description: 'Directory contents' })
  @ApiResponse({ status: 403, description: 'Path traversal or symlink violation' })
  @ApiResponse({ status: 404, description: 'Server or path not found' })
  async listFiles(@Param('id') id: string, @Query('path') relPath?: string) {
    return this.filesService.listFiles(id, relPath || '');
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'Read text file content from server /data storage' })
  @ApiResponse({ status: 200, description: 'File content' })
  @ApiResponse({ status: 403, description: 'Path traversal or symlink violation' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async readFile(@Param('id') id: string, @Query('path') relPath: string) {
    return this.filesService.readFile(id, relPath);
  }

  @Put(':id/file')
  @ApiOperation({ summary: 'Save/overwrite file content into server /data storage atomically' })
  @ApiResponse({ status: 200, description: 'File saved successfully' })
  @ApiResponse({ status: 403, description: 'Path traversal or symlink violation' })
  async writeFile(
    @Param('id') id: string,
    @Query('path') relPath: string,
    @Body() dto: WriteFileDto,
  ) {
    return this.filesService.writeFile(id, relPath, dto.content);
  }

  @Delete(':id/file')
  @ApiOperation({ summary: 'Delete file or directory from server /data storage' })
  @ApiResponse({ status: 200, description: 'File or directory removed successfully' })
  @ApiResponse({ status: 403, description: 'Path traversal or symlink violation' })
  async deleteFile(@Param('id') id: string, @Query('path') relPath: string) {
    return this.filesService.deleteFile(id, relPath);
  }

  @Post(':id/world/upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload world archive (.zip, .tar.gz) and extract into server /data' })
  @ApiResponse({ status: 202, description: 'World archive extracted successfully' })
  @ApiResponse({ status: 409, description: 'Conflict: server is running or starting' })
  @ApiResponse({ status: 403, description: 'Zip-slip or forbidden symlink detected' })
  async uploadWorld(
    @Param('id') id: string,
    @UploadedFile() file?: any,
  ) {
    return this.filesService.uploadWorld(id, file);
  }
}

