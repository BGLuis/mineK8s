import { ApiProperty } from '@nestjs/swagger';

export class MyServerDto {
  @ApiProperty({
    description: 'Nome de exibição do servidor',
    example: 'Survival Principal',
  })
  name!: string;

  @ApiProperty({
    description: 'Endereço para conexão no Minecraft',
    example: 'survival.mc.example.com',
  })
  address!: string;

  @ApiProperty({
    description: 'Estado atual do servidor para o jogador',
    example: 'READY',
  })
  state!: string;

  @ApiProperty({
    description: 'Quantidade de jogadores conectados no momento',
    example: 3,
  })
  playersOnline!: number;

  @ApiProperty({
    description: 'Ícone do servidor em data URI base64 PNG ou null',
    nullable: true,
    example: 'data:image/png;base64,...',
  })
  icon!: string | null;
}
