import {
  Controller,
  Post,
  Get,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { BackupsService } from './backups.service';

@Controller('api/servers')
export class BackupsController {
  constructor(private readonly backupsService: BackupsService) {}

  /**
   * POST /api/servers/:id/backup
   * Dispara um K8s Job que comprime todo o /data em um .tar.gz no PVC de backups.
   * Retorna imediatamente com o jobName para acompanhar o status.
   */
  @Post(':id/backup')
  @HttpCode(HttpStatus.ACCEPTED)
  async createBackup(@Param('id') id: string) {
    return await this.backupsService.createBackup(id);
  }

  /**
   * GET /api/servers/:id/backup
   * Lista todos os .tar.gz disponíveis para este servidor no PVC global de backups.
   */
  @Get(':id/backup')
  async listBackups(@Param('id') id: string) {
    return await this.backupsService.listBackups(id);
  }

  /**
   * GET /api/servers/:id/backup/status/:jobName
   * Retorna o status do Job de backup OU de restore (compartilham o mesmo polling).
   * Use polling (ex: a cada 5s) até status !== 'running'.
   */
  @Get(':id/backup/status/:jobName')
  async getJobStatus(
    @Param('id') _id: string,
    @Param('jobName') jobName: string,
  ) {
    return await this.backupsService.getJobStatus(jobName);
  }

  /**
   * POST /api/servers/:id/restore/:filename
   * ⚠️  AÇÃO DESTRUTIVA: apaga /data atual e extrai o backup no lugar.
   * O servidor DEVE estar offline (replicas=0) antes de chamar este endpoint.
   * Retorna jobName para acompanhar o status via GET /backup/status/:jobName.
   *
   * Exemplo: POST /api/servers/mc-survival-abc/restore/mc-survival-abc-2026-06-12t08-30-00-000z.tar.gz
   */
  @Post(':id/restore/:filename')
  @HttpCode(HttpStatus.ACCEPTED)
  async restoreBackup(
    @Param('id') id: string,
    @Param('filename') filename: string,
  ) {
    return await this.backupsService.restoreBackup(id, filename);
  }
}

