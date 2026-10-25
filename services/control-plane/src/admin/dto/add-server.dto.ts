import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddServerDto {
  @ApiProperty({
    description: 'ID do servidor (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID(undefined, { message: 'serverId must be a valid UUID' })
  serverId: string;
}
