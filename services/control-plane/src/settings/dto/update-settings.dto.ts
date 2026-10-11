import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class UpdateSettingsDto {
  @ApiProperty({
    description:
      'Chave da configuração e novo valor. null remove o valor do banco, e o ambiente (ou o padrão) volta a valer. Cada chave é validada pelo serviço.',
    example: { 'access.publicUrl': 'https://painel.mine.internal', 'cloudflare.apiToken': null },
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  values: Record<string, unknown>;
}
