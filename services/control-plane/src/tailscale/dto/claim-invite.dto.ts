import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches, MinLength } from 'class-validator';

/**
 * DTO para resgate de convites no portal /join ou API pública (RF-TS-08, RF-TS-11).
 */
export class ClaimInviteDto {
  @ApiProperty({
    description: 'Token criptográfico do convite recebido pelo link',
    minLength: 16,
    example: 'd9b73f8a0e2c418fb263914a87e50c4f',
  })
  @IsString()
  @MinLength(16, { message: 'Invalid or too short invite token' })
  token: string;

  @ApiProperty({
    description: 'Nome real / de identificação do amigo ou participante',
    minLength: 2,
    maxLength: 100,
    example: 'Lucas Henrique',
  })
  @IsString()
  @Length(2, 100, { message: 'Real name must be between 2 and 100 characters' })
  realName: string;

  @ApiProperty({
    description: 'Nickname Vanilla do Minecraft (RF-ARQ-21, C-06: 3-16 alfanuméricos ou underline)',
    pattern: '^[a-zA-Z0-9_]{3,16}$',
    example: 'LucasCraft',
  })
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{3,16}$/, {
    message: 'Nickname must contain 3 to 16 alphanumeric characters or underscores',
  })
  minecraftNick: string;
}
