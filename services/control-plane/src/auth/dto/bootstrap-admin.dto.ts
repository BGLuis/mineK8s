import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class BootstrapAdminDTO {
  @ApiProperty({
    description: 'Ephemeral bootstrap token printed in container logs on initial startup',
    example: 'd9b1a039-4467-4221-8208-1643c1dc30c0',
  })
  @IsString()
  @IsNotEmpty()
  bootstrap_token: string;

  @ApiProperty({
    description: 'Minecraft nickname of the initial administrator (3 to 16 chars)',
    example: 'AdminSteve',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(16)
  @Matches(/^[a-zA-Z0-9_]{3,16}$/, {
    message: 'minecraft_nick must contain only letters, numbers and underscores (3-16 chars)',
  })
  minecraft_nick: string;

  @ApiProperty({
    description: 'Optional contact email',
    example: 'admin@minek8s.local',
    required: false,
  })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiProperty({
    description: 'Optional real name',
    example: 'Server Administrator',
    required: false,
  })
  @IsString()
  @IsOptional()
  real_name?: string;
}
