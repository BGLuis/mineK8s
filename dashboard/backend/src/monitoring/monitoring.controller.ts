import { Controller, Get, Param } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';

@Controller('api/monitoring')
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  /**
   * GET /api/monitoring
   * Retorna as métricas (CPU e Memória) de todos os servidores Minecraft que estão ligados.
   */
  @Get()
  async getAllMetrics() {
    return await this.monitoringService.getMetrics();
  }

  /**
   * GET /api/monitoring/:id
   * Retorna as métricas (CPU e Memória) de um servidor Minecraft específico.
   * Se o servidor estiver desligado, retorna { cpuCores: 0, memoryMb: 0 }
   */
  @Get(':id')
  async getServerMetrics(@Param('id') id: string) {
    return await this.monitoringService.getServerMetrics(id);
  }
}
