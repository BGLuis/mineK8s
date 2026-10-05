import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InstallModpackDto {
  @ApiProperty({
    enum: ['MODRINTH', 'CURSEFORGE', 'VANILLA', 'CUSTOM'],
    default: 'MODRINTH',
    description: 'Plataforma de origem do modpack',
  })
  @IsEnum(['MODRINTH', 'CURSEFORGE', 'VANILLA', 'CUSTOM'])
  source: 'MODRINTH' | 'CURSEFORGE' | 'VANILLA' | 'CUSTOM';

  @ApiProperty({ description: 'Identificador único do projeto no catálogo' })
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ description: 'Identificador único da versão / release do modpack' })
  @IsString()
  @IsNotEmpty()
  versionId: string;

  @ApiPropertyOptional({
    description: 'URL opcional para download direto do arquivo .mrpack ou .zip',
  })
  @IsOptional()
  @IsString()
  archiveUrl?: string;
}
