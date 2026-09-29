import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateVersionDto {
  @ApiProperty({
    description: 'Nova versão do jogo/servidor (ex.: 1.21.0 ou 0.2.5 para modpacks)',
    example: '1.20.4',
  })
  @IsString()
  @IsNotEmpty()
  game_version: string;

  @ApiPropertyOptional({
    description: 'Tipo de servidor (PAPER, FORGE, FABRIC, NEOFORGE, etc.)',
    example: 'PAPER',
  })
  @IsString()
  @IsOptional()
  server_type?: string;

  @ApiPropertyOptional({
    description: 'Identificador do modpack caso aplicável',
    example: 'all-the-mods-9',
  })
  @IsString()
  @IsOptional()
  modpack_id?: string;

  @ApiPropertyOptional({
    description: 'Purga seletiva da pasta mods/ antes de instalar nova versão (RF-STO-13)',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  purge_mods?: boolean;
}
