import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TailscaleService, CreateInviteDto } from './tailscale.service';

@Controller('api/tailscale')
export class TailscaleController {
  constructor(private readonly tailscaleService: TailscaleService) {}

  /**
   * POST /api/tailscale/invite
   * Gera uma Pre-Auth Key e retorna a URL pública de convite.
   * Chamado apenas pelo admin na dashboard (rota privada via Tailscale).
   */
  @Post('invite')
  @HttpCode(HttpStatus.CREATED)
  async createInvite(@Body() dto: CreateInviteDto) {
    return await this.tailscaleService.createInvite(dto);
  }

  /**
   * GET /api/tailscale/devices
   * Lista os dispositivos Minecraft conectados na tailnet.
   */
  @Get('devices')
  async listDevices() {
    return await this.tailscaleService.listMinecraftDevices();
  }

  /**
   * DELETE /api/tailscale/devices/:deviceId
   * Remove (kick) um dispositivo da tailnet.
   */
  @Delete('devices/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeDevice(@Param('deviceId') deviceId: string) {
    await this.tailscaleService.revokeDevice(deviceId);
  }
}
