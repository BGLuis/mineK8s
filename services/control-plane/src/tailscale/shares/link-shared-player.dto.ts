import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class LinkSharedPlayerDto {
  @ApiProperty({ description: 'ID do usuário no sistema' })
  @IsUUID('4')
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'Tailscale User ID numérico capturado pelo Gateway' })
  @IsString()
  @IsNotEmpty()
  tailscaleUserId: string;

  @ApiProperty({ required: false, description: 'Usuário do GitHub associado à conta Tailscale' })
  @IsOptional()
  @IsString()
  githubUsername?: string;
}
