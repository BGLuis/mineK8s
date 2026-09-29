import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SmartKickDto {
  @ApiProperty({ example: 'srv-survival-uuid', description: 'ID do servidor onde a sessão está ativa' })
  @IsString()
  serverId: string;

  @ApiProperty({ example: 'LucasCraft', description: 'Nickname do jogador no Minecraft Vanilla' })
  @IsString()
  minecraftNick: string;

  @ApiProperty({ example: 'Permissão revogada pelo administrador', required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}
