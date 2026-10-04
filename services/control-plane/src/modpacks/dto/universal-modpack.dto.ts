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

  @ApiPropertyOptional({ description: 'Versão do Minecraft mais recente suportada' })
  gameVersion?: string;

  @ApiPropertyOptional({ description: 'Loader do modpack (fabric, forge, neoforge, quilt)' })
  loader?: string;

  @ApiPropertyOptional({ description: 'Data da última atualização do modpack' })
  dateModified?: Date;
}

export class ModpackSearchResponseDto {
  @ApiProperty({ description: 'Total de resultados nas fontes consultadas, ignorando a paginação' })
  total: number;

  @ApiProperty({ description: 'Deslocamento aplicado à busca' })
  offset: number;

  @ApiProperty({ description: 'Tamanho máximo da página' })
  limit: number;

  @ApiProperty({ type: [UniversalModpackDto] })
  results: UniversalModpackDto[];
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
