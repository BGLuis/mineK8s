import { Controller, Get, Patch, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { SleepModeService } from './sleep-mode.service';

export class SetHibernateDto {
  /**
   * Minutos de inatividade antes de hibernar.
   * null = Always On (nunca hiberna).
   */
  hibernateAfterMinutes: number | null;
}

@Controller('api/sleep-mode')
export class SleepModeController {
  constructor(private readonly sleepModeService: SleepModeService) {}

  /**
   * GET /api/sleep-mode/status
   * Retorna o status de hibernação de todos os servidores:
   * modo (always-on | hibernate), tempo de inatividade atual e quando vai hibernar.
   */
  @Get('status')
  async getStatus() {
    return await this.sleepModeService.getSleepModeStatus();
  }

  /**
   * PATCH /api/sleep-mode/:id
   * Atualiza a configuração de hibernação de um servidor existente.
   * Body: { "hibernateAfterMinutes": 30 }  → hiberna após 30min
   * Body: { "hibernateAfterMinutes": null } → Always On
   */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async setHibernateConfig(
    @Param('id') id: string,
    @Body() dto: SetHibernateDto,
  ) {
    return await this.sleepModeService.setHibernateConfig(id, dto.hibernateAfterMinutes);
  }
}
