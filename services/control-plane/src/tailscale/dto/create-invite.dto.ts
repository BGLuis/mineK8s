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
  @MinLength(3, { message: 'Invite name must have at least 3 characters' })
  @MaxLength(100, { message: 'Invite name must have at most 100 characters' })
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
  @Min(1, { message: 'The number of uses must be at least 1' })
  @Max(500, { message: 'The number of uses cannot exceed 500' })
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
  @Min(1, { message: 'The minimum validity is 1 day' })
  @Max(90, { message: 'The maximum validity is 90 days' })
  expiresInDays?: number = 7;

  @ApiProperty({
    description: 'Lista de IDs de grupos atribuídos automaticamente ao usuário resgatante (RF-TS-03)',
    type: [String],
    example: ['b1a95e7c-88eb-4b2a-b60f-21f4df463e2a'],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'Each groupId must be a valid UUID v4' })
  groupIds?: string[];

  @ApiProperty({
    description: 'Lista de IDs de servidores com acesso nominal pré-concedido (RF-TS-03)',
    type: [String],
    example: ['c2b06f8d-99fc-4c3b-a71e-32e5ef574f3b'],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'Each serverId must be a valid UUID v4' })
  serverIds?: string[];
}
