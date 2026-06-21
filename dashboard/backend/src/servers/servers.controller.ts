import { Controller, Post, Body, Get, Param, Delete, Query, Put, Patch, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ServersService, CreateServerDto } from './servers.service';
import { UpdateService, StartUpdateDto } from './update.service';

@Controller('api/servers')
export class ServersController {
  constructor(
    private readonly serversService: ServersService,
    private readonly updateService: UpdateService,
  ) {}

  @Post('create')
  async createServer(@Body() dto: CreateServerDto) {
    return await this.serversService.createServer(dto);
  }

  @Get()
  async getServers() {
    return await this.serversService.getServers();
  }

  @Post(':id/start')
  async startServer(@Param('id') id: string) {
    return await this.serversService.scaleServer(id, 1);
  }

  @Post(':id/stop')
  async stopServer(@Param('id') id: string) {
    return await this.serversService.scaleServer(id, 0);
  }

  @Delete(':id')
  async deleteServer(@Param('id') id: string) {
    return await this.serversService.deleteServer(id);
  }

  @Get(':id/logs')
  async getLogs(@Param('id') id: string) {
    return await this.serversService.getLogs(id);
  }

  @Post(':id/command')
  async sendCommand(@Param('id') id: string, @Body('command') command: string) {
    return await this.serversService.sendCommand(id, command);
  }

  @Get(':id/players')
  async getPlayers(@Param('id') id: string) {
    return await this.serversService.getPlayers(id);
  }

  @Get(':id/files')
  async listFiles(@Param('id') id: string, @Query('path') path?: string) {
    return await this.serversService.listFiles(id, path || '');
  }

  @Get(':id/file')
  async readFile(@Param('id') id: string, @Query('path') path: string) {
    return await this.serversService.readFile(id, path);
  }

  /**
   * PUT /api/servers/:id/file?path=server.properties
   * Body: { "content": "...conteúdo do arquivo..." }
   * Salva (sobrescreve) um arquivo dentro do pod via stdin pipe.
   */
  @Put(':id/file')
  async writeFile(
    @Param('id') id: string,
    @Query('path') path: string,
    @Body('content') content: string,
  ) {
    return await this.serversService.writeFile(id, path, content);
  }

  /**
   * DELETE /api/servers/:id/file?path=world/region
   * Remove um arquivo ou pasta dentro do pod (rm -rf restrito ao /data/).
   */
  @Delete(':id/file')
  async deleteFile(@Param('id') id: string, @Query('path') path: string) {
    return await this.serversService.deleteFile(id, path);
  }

  /**
   * PATCH /api/servers/:id/update
   * Body: { "version": "12345", "source": "CurseForge" }
   *
   * Inicia o pipeline de atualização segura:
   *   1. Para o servidor
   *   2. Cria backup automático
   *   3. Aplica nova versão
   *   4. Monitora inicialização
   *   5. Em caso de falha: rollback automático dos dados + versão
   *
   * Retorna imediatamente com { taskId }. Use GET /update/status/:taskId para acompanhar.
   */
  @Patch(':id/update')
  async startUpdate(
    @Param('id') id: string,
    @Body() dto: StartUpdateDto,
  ) {
    return this.updateService.startUpdate(id, dto);
  }

  /**
   * GET /api/servers/:id/update/status/:taskId
   * Retorna a fase atual do pipeline:
   *   stopping | backing-up | updating | monitoring | success | rolling-back | rolled-back | failed
   */
  @Get(':id/update/status/:taskId')
  async getUpdateStatus(
    @Param('id') _id: string,
    @Param('taskId') taskId: string,
  ) {
    return this.updateService.getTask(taskId);
  }

  /**
   * POST /api/servers/:id/world/upload
   * Recebe um arquivo .zip ou .tar.gz contendo o mundo (ou partes do /data)
   * e extrai de forma autônoma via Kubernetes Job.
   */
  @Post(':id/world/upload')
  @UseInterceptors(FileInterceptor('file', { dest: '/var/minekube/uploads' }))
  async uploadWorld(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return await this.serversService.uploadWorld(id, file);
  }

  @Patch(':id/domain')
  async updateDomain(
    @Param('id') id: string,
    @Body('domain') domain: string,
  ) {
    return await this.serversService.updateDomain(id, domain);
  }
}
