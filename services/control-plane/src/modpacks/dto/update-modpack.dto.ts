import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateModpackDto {
  @ApiProperty({ description: 'Versão do modpack no catálogo para a qual o servidor será trocado' })
  @IsString()
  @IsNotEmpty()
  versionId: string;

  @ApiPropertyOptional({
    description: 'Confirmação explícita quando a nova versão do pack usa um Minecraft anterior',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  confirm_downgrade?: boolean;

  @ApiPropertyOptional({
    description: 'Minutos de aviso aos jogadores antes de parar para atualizar (0 = agora)',
    default: 10,
  })
  @IsNumber()
  @IsOptional()
  warning_minutes?: number;
}
