import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UniversalModpackDto {
  @ApiProperty({ description: 'ID canônico do modpack' })
  id: string;

  @ApiProperty({ description: 'Nome do modpack' })
  name: string;

  @ApiProperty({ description: 'Descrição / sumário do modpack' })
  summary: string;

  @ApiProperty({ enum: ['MODRINTH', 'CURSEFORGE', 'VANILLA', 'CUSTOM'], description: 'Origem do catálogo' })
  source: 'MODRINTH' | 'CURSEFORGE' | 'VANILLA' | 'CUSTOM';

  @ApiPropertyOptional({ description: 'Autor ou time responsável' })
  author?: string;

  @ApiPropertyOptional({ description: 'URL do ícone ou logo' })
  iconUrl?: string;

  @ApiProperty({ description: 'Total de downloads acumulados' })
  downloads: number;
}

export class ModpackVersionDto {
  @ApiProperty({ description: 'ID único da versão' })
  id: string;

  @ApiProperty({ description: 'Nome da versão (ex: 1.0.0)' })
  name: string;

  @ApiProperty({ description: 'Versão do Minecraft suportada' })
  gameVersion: string;

  @ApiProperty({ description: 'Tipo do loader (fabric, forge, neoforge, quilt)' })
  loader: string;

  @ApiProperty({ description: 'Tipo do release (release, beta, alpha)' })
  releaseType: string;

  @ApiProperty({ description: 'Data de publicação' })
  datePublished: Date;

  @ApiPropertyOptional({ description: 'URL direta para download do pacote' })
  downloadUrl?: string;
}
