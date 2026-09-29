import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * DTO para emissão de convites na rede privada Tailscale (RF-TS-03, RF-TS-11, RF-ARQ-19).
 */
export class CreateInviteDto {
  @ApiProperty({
    description: 'Nome identificador do convite (ex: "Galera do Discord")',
    minLength: 3,
    maxLength: 100,
    example: 'Galera do Discord',
  })
  @IsString()
  @MinLength(3, { message: 'O nome do convite deve ter no mínimo 3 caracteres' })
  @MaxLength(100, { message: 'O nome do convite deve ter no máximo 100 caracteres' })
  name: string;

  @ApiProperty({
    description: 'Número máximo de utilizações permitidas para o convite',
    minimum: 1,
    maximum: 500,
    default: 1,
    example: 5,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'O número de usos deve ser pelo menos 1' })
  @Max(500, { message: 'O número de usos não pode exceder 500' })
  maxUses?: number = 1;

  @ApiProperty({
    description: 'Prazo de expiração do convite em dias',
    minimum: 1,
    maximum: 90,
    default: 7,
    example: 7,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'A validade mínima é de 1 dia' })
  @Max(90, { message: 'A validade máxima é de 90 dias' })
  expiresInDays?: number = 7;

  @ApiProperty({
    description: 'Lista de IDs de grupos atribuídos automaticamente ao usuário resgatante (RF-TS-03)',
    type: [String],
    example: ['b1a95e7c-88eb-4b2a-b60f-21f4df463e2a'],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'Cada grupoId deve ser um UUID v4 válido' })
  groupIds?: string[];

  @ApiProperty({
    description: 'Lista de IDs de servidores com acesso nominal pré-concedido (RF-TS-03)',
    type: [String],
    example: ['c2b06f8d-99fc-4c3b-a71e-32e5ef574f3b'],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'Cada serverId deve ser um UUID v4 válido' })
  serverIds?: string[];
}
