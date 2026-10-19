import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ContentActionItemDto {
  @ApiProperty({ description: 'Caminho relativo do arquivo (ex.: mods/jei.jar)' })
  @IsString()
  @IsNotEmpty()
  path: string;

  @ApiProperty({
    description: 'Ação a ser executada',
    enum: ['UPDATE', 'REMOVE', 'KEEP'],
  })
  @IsIn(['UPDATE', 'REMOVE', 'KEEP'])
  action: 'UPDATE' | 'REMOVE' | 'KEEP';

  @ApiPropertyOptional({ description: 'ID da versão de destino caso action seja UPDATE' })
  @IsString()
  @IsOptional()
  targetVersionId?: string;

  @ApiPropertyOptional({ description: 'URL de download da nova versão' })
  @IsString()
  @IsOptional()
  targetDownloadUrl?: string;

  @ApiPropertyOptional({ description: 'Nome do arquivo de destino caso mude' })
  @IsString()
  @IsOptional()
  targetFileName?: string;

  @ApiPropertyOptional({ description: 'Hashes esperados do novo arquivo' })
  @IsOptional()
  targetHashes?: { sha1?: string; sha512?: string; sha256?: string };
}

export class PreviewUpdateVersionDto {
  @ApiProperty({
    description: 'Versão alvo do jogo/servidor',
    example: '1.21.1',
  })
  @IsString()
  @IsNotEmpty()
  game_version: string;

  @ApiPropertyOptional({
    description: 'Tipo de servidor de destino (FABRIC, FORGE, PAPER, etc.)',
    example: 'FABRIC',
  })
  @IsString()
  @IsOptional()
  server_type?: string;

  @ApiPropertyOptional({
    description: 'ID do modpack caso aplicável',
  })
  @IsString()
  @IsOptional()
  modpack_id?: string;

  @ApiPropertyOptional({
    description: 'ID da versão do modpack caso aplicável',
  })
  @IsString()
  @IsOptional()
  modpack_version_id?: string;
}

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
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  purge_mods?: boolean;

  @ApiPropertyOptional({
    description: 'Confirmação explícita de downgrade para versões anteriores (#203)',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  confirm_downgrade?: boolean;

  @ApiPropertyOptional({
    description:
      'Tempo em minutos de aviso aos jogadores antes de parar para atualizar (0 = agora) (#204)',
    default: 10,
  })
  @IsNumber()
  @IsOptional()
  warning_minutes?: number;

  @ApiPropertyOptional({
    description: 'Ações decididas pelo admin para mods e plugins (#207)',
    type: [ContentActionItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContentActionItemDto)
  @IsOptional()
  content_actions?: ContentActionItemDto[];
}
