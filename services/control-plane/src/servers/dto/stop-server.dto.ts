import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class StopServerDto {
  @ApiPropertyOptional({
    description:
      'Tempo em minutos de aviso aos jogadores antes de parar/reiniciar (0 = agora) (#204)',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  warning_minutes?: number;
}
