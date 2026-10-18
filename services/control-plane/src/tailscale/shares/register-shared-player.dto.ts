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

export function normalizeGithubUsername(raw?: string | null): string | null {
  if (!raw) {
    return null;
  }
  let clean = raw.trim().toLowerCase();
  clean = clean.replace(/^https?:\/\/github\.com\//, '');
  clean = clean.replace(/@\.?github(\.com)?$/, '');
  clean = clean.replace(/^@/, '');
  clean = clean.trim();
  return clean || null;
}

export function isValidGithubUsername(username: string): boolean {
  return /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i.test(username);
}

/** Cadastro de quem vai receber o nó compartilhado do Gateway pelo Tailscale. */
export class RegisterSharedPlayerDto {
  @ApiProperty({
    required: false,
    description:
      'E-mail da conta Tailscale que receberá o compartilhamento (o mesmo do login dela)',
    example: 'amigo@example.com',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @ApiProperty({
    required: false,
    description: 'Usuário do GitHub da conta Tailscale (com ou sem @ ou @github)',
    example: 'amigo',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  github?: string;

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
