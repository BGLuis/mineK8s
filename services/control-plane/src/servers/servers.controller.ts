import * as fs from 'node:fs';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '@auth/roles.decorator';
import { UserRole } from '@database/entities/user.entity';

import { ServersService } from './servers.service';
import { ServersFilesService } from './servers-files.service';
import { ServersBackupService } from './servers-backup.service';
import { CreateServerDto, MinecraftSettingsDto } from './dto/create-server.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';
import { UpdateServerDto } from './dto/update-server.dto';
import { CommandDto } from './dto/command.dto';
import { WriteFileDto } from './dto/write-file.dto';
import { CreateDirectoryDto } from './dto/create-directory.dto';
import { RenameFileDto } from './dto/rename-file.dto';
import { UpdateVersionDto } from './dto/update-version.dto';
import { CreateBackupDto } from './dto/create-backup.dto';
import { RestoreBackupDto } from './dto/restore-backup.dto';

@ApiTags('Servers & Kubernetes Orchestration')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('api/servers')
export class ServersController {
  constructor(
    private readonly serversService: ServersService,
    private readonly filesService: ServersFilesService,
    private readonly backupService: ServersBackupService,
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

  @Get(':id/players')
  @ApiOperation({
    summary: 'List players currently connected through the gateway, with session start',
  })
  @ApiResponse({ status: 200, description: 'Online count, slot limit and sessions' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async players(@Param('id') id: string) {
    return this.serversService.getPlayers(id);
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

  @Post(':id/restart')
  @ApiOperation({
    summary: 'Restart a running server with graceful shutdown (save-all, stop, start)',
  })
  @ApiResponse({ status: 200, description: 'Server restart initiated' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  @ApiResponse({ status: 409, description: 'Server is not running' })
  async restart(@Param('id') id: string) {
    return this.serversService.restart(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update quick settings (sleep timeout, auto-wake, maintenance, access policy) and sync the Gateway',
  })
  @ApiResponse({ status: 200, description: 'Server updated' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  @ApiResponse({ status: 409, description: 'Server is published on the internet' })
  async update(@Param('id') id: string, @Body() dto: UpdateServerDto) {
    return this.serversService.update(id, dto);
  }

  @Post(':id/update-version')
  @ApiOperation({
    summary: 'Update server version with pre-update backup and automated rollback (RF-STO-13)',
  })
  @ApiResponse({ status: 200, description: 'Version update result' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  @ApiResponse({ status: 409, description: 'Server is already being updated' })
  async updateVersion(@Param('id') id: string, @Body() dto: UpdateVersionDto) {
    return this.serversService.updateVersion(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a server and deprovision Kubernetes resources' })
  @ApiResponse({ status: 200, description: 'Server deleted and resources deprovisioned' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async delete(@Param('id') id: string) {
    return this.serversService.delete(id);
  }

  @Patch(':id/settings')
  @ApiOperation({
    summary: 'Update the Minecraft settings (server.properties); they apply on the next start',
  })
  @ApiResponse({ status: 200, description: 'Settings saved' })
  @ApiResponse({ status: 400, description: 'Empty body or RCON password change' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  @ApiResponse({ status: 409, description: 'Server is published: online-mode must stay on' })
  async updateSettings(@Param('id') id: string, @Body() dto: MinecraftSettingsDto) {
    return this.serversService.updateSettings(id, dto);
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
  async sendCommand(@Param('id') id: string, @Body() dto: CommandDto, @Req() req?: any) {
    return this.serversService.sendCommand(id, dto.command, {
      user: req?.user,
      ipAddress: req?.ip || req?.connection?.remoteAddress,
      source: 'REST_API',
    });
  }

  @Get(':id/files')
  @ApiOperation({
    summary: 'List files and directories inside server /data storage (RF-ARQ-17, L-04)',
  })
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
  async uploadWorld(@Param('id') id: string, @UploadedFile() file?: any) {
    return this.filesService.uploadWorld(id, file);
  }

  @Post(':id/files/upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a single file into server /data storage' })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file name or no file provided' })
  @ApiResponse({ status: 403, description: 'Path traversal attempt' })
  @ApiResponse({ status: 409, description: 'Conflict: modifying world while server is running' })
  async uploadFile(
    @Param('id') id: string,
    @Query('path') relPath: string = '',
    @UploadedFile() file?: any,
  ) {
    return this.filesService.uploadFile(id, relPath, file);
  }

  @Post(':id/files/directory')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new directory in server /data storage' })
  @ApiResponse({ status: 201, description: 'Directory created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid directory name' })
  @ApiResponse({ status: 403, description: 'Path traversal attempt' })
  @ApiResponse({ status: 409, description: 'Directory already exists or server is running' })
  async createDirectory(@Param('id') id: string, @Body() dto: CreateDirectoryDto) {
    return this.filesService.createDirectory(id, dto.path || '', dto.name);
  }

  @Post(':id/files/rename')
  @ApiOperation({ summary: 'Rename a file or directory in server /data storage' })
  @ApiResponse({ status: 200, description: 'File or directory renamed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid paths or session.lock modification' })
  @ApiResponse({ status: 403, description: 'Path traversal attempt' })
  @ApiResponse({ status: 404, description: 'Source path not found' })
  @ApiResponse({ status: 409, description: 'Target already exists or server is running' })
  async renameFile(@Param('id') id: string, @Body() dto: RenameFileDto) {
    return this.filesService.renamePath(id, dto.oldPath, dto.newPath);
  }

  @Post(':id/backups')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Criar backup do servidor (HOT ou COLD) (RF-STO-17)' })
  @ApiResponse({ status: 202, description: 'Backup iniciado ou concluído com sucesso' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  @ApiResponse({ status: 409, description: 'Conflito de estado ou tarefa em andamento' })
  async createBackup(@Param('id') id: string, @Body() dto?: CreateBackupDto) {
    if (dto?.taskId) {
      return this.backupService.createBackupForServer(id, dto.type || 'HOT', dto.taskId);
    }
    return this.backupService.createBackupForServer(id, dto?.type || 'HOT');
  }

  @Get(':id/backups')
  @ApiOperation({ summary: 'Listar backups ordenados por data decrescente (RF-STO-17)' })
  @ApiResponse({ status: 200, description: 'Lista de backups da instância' })
  async listBackups(@Param('id') id: string) {
    return this.backupService.listBackups(id);
  }

  @Delete(':id/backups/:backupId')
  @ApiOperation({ summary: 'Remover backup físico e registro do banco (RF-STO-15, RF-STO-17)' })
  @ApiResponse({ status: 200, description: 'Backup removed successfully' })
  @ApiResponse({ status: 403, description: 'Tentativa de remover backup protegido sem force=true' })
  @ApiResponse({
    status: 400,
    description: 'Tentativa de remover backup pre-restore dentro de 48h',
  })
  @ApiResponse({ status: 404, description: 'Backup não encontrado' })
  async deleteBackup(
    @Param('id') id: string,
    @Param('backupId') backupId: string,
    @Query('force') force?: string,
  ) {
    return this.backupService.deleteBackup(id, backupId, force === 'true');
  }

  @Post(':id/backups/:backupId/restore')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Restaurar backup transacionalmente com staging e rollback (RF-STO-17)',
  })
  @ApiResponse({ status: 202, description: 'Restauração transacional executada' })
  @ApiResponse({ status: 404, description: 'Servidor ou backup não encontrado' })
  @ApiResponse({ status: 409, description: 'Instância não está STOPPED' })
  async restoreBackup(
    @Param('id') id: string,
    @Param('backupId') backupId: string,
    @Body() dto?: RestoreBackupDto,
  ) {
    if (dto?.taskId) {
      return this.backupService.restoreBackupById(id, backupId, dto.taskId);
    }
    return this.backupService.restoreBackupById(id, backupId);
  }

  @Get(':id/backups/:backupId/download')
  @ApiOperation({ summary: 'Baixar arquivo de backup via streaming HTTP (.tar.gz) (RF-STO-17)' })
  @ApiResponse({ status: 200, description: 'Stream binário do arquivo .tar.gz' })
  @ApiResponse({ status: 404, description: 'Backup ou arquivo físico não encontrado' })
  async downloadBackup(
    @Param('id') id: string,
    @Param('backupId') backupId: string,
    @Res() res: Response,
  ) {
    const backup = await this.backupService.getBackup(id, backupId);
    if (!fs.existsSync(backup.storagePath)) {
      throw new NotFoundException(`Backup file not found in the storage pool`);
    }

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
    res.setHeader('Content-Length', backup.sizeBytes);

    const stream = fs.createReadStream(backup.storagePath);
    stream.pipe(res);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publicar servidor publicamente na internet via Cloudflare SRV (RF-CF-07)',
  })
  @ApiResponse({
    status: 200,
    description: 'Servidor publicado com política INTERNET e online-mode=true',
  })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async publish(@Param('id') id: string) {
    return this.serversService.publishServer(id);
  }

  @Delete(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Despublicar servidor da internet e reverter registro Cloudflare (RF-CF-07)',
  })
  @ApiResponse({ status: 200, description: 'Servidor despublicado e retornado à política padrão' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async unpublish(@Param('id') id: string) {
    return this.serversService.unpublishServer(id);
  }
}
