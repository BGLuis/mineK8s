import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/** Cadastro de quem vai receber o nó compartilhado do Gateway pelo Tailscale. */
export class RegisterSharedPlayerDto {
  @ApiProperty({
    description:
      'E-mail da conta Tailscale que receberá o compartilhamento (o mesmo do login dela)',
    example: 'amigo@example.com',
  })
  @IsEmail({}, { message: 'Tailscale account e-mail is invalid' })
  @MaxLength(255)
  email: string;

  @ApiProperty({
    description: 'Nickname do Minecraft (3-16 alfanuméricos ou underline)',
    pattern: '^[a-zA-Z0-9_]{3,16}$',
    example: 'AmigoCraft',
  })
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{3,16}$/, {
    message: 'Nickname must contain 3 to 16 alphanumeric characters or underscores',
  })
  minecraftNick: string;

  @ApiProperty({ required: false, example: 'Amigo da Escola' })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  realName?: string;

  @ApiProperty({ required: false, type: [String], description: 'Grupos de acesso do jogador' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  groupIds?: string[];

  @ApiProperty({ required: false, type: [String], description: 'Mundos liberados nominalmente' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  serverIds?: string[];
}
