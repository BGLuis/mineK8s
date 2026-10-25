import { Controller, Get, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { User } from '../database/entities/user.entity';
import { AdminService } from './admin.service';
import { MyServerDto } from './dto/my-server.dto';

@ApiTags('Player Area')
@ApiBearerAuth()
@Controller('api/me')
export class MeController {
  constructor(private readonly adminService: AdminService) {}

  @Get('servers')
  @ApiOperation({ summary: 'Listar servidores acessíveis pelo jogador logado (#216)' })
  @ApiResponse({ status: 200, type: [MyServerDto] })
  async listMyServers(@Req() req: Request & { user: User }): Promise<MyServerDto[]> {
    return this.adminService.listMyServers(req.user);
  }
}
