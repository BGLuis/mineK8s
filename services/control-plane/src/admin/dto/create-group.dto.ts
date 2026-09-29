import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ example: 'Veteranos', minLength: 2, maxLength: 50 })
  @IsString()
  @Length(2, 50, { message: 'O nome do grupo deve ter entre 2 e 50 caracteres' })
  name: string;

  @ApiProperty({ example: 'Membros com acesso aos servidores pesados de modpacks', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}
