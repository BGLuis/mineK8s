import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDTO {
  @ApiProperty({
    description: 'Registered Minecraft nickname',
    example: 'AdminSteve',
  })
  @IsString()
  @IsNotEmpty()
  minecraft_nick: string;

  @ApiProperty({
    description: 'Tailscale user identifier or node ID (if connecting via Tailscale)',
    required: false,
  })
  @IsString()
  @IsOptional()
  tailscale_user_id?: string;
}
