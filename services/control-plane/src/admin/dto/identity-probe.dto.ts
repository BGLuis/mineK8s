import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import type { NetworkIdentity } from '../../tailscale/identity/network-identity-provider.interface';
import type { IdentityMatchedBy } from '../../gateway-ipc/gateway-ipc.service';
import type { NicknameDecisionResult } from '../../tailscale/decision/access-decision-engine.service';
import type { AccessGrantedBy } from '../../tailscale/decision/access-resolver.service';

export class IdentityProbeDto {
  @ApiPropertyOptional({ description: 'ID de usuário no Tailscale' })
  @IsOptional()
  @IsString()
  tailscaleUserId?: string;

  @ApiPropertyOptional({ description: 'Endereço IP Tailscale do jogador' })
  @IsOptional()
  @IsString()
  ip?: string;

  @ApiPropertyOptional({ description: 'Nickname declarado no Minecraft' })
  @IsOptional()
  @IsString()
  minecraftNick?: string;
}

export class ProbedUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  minecraftNick: string;

  @ApiProperty({ nullable: true })
  realName: string | null;

  @ApiProperty({ nullable: true })
  email: string | null;

  @ApiProperty({ nullable: true })
  githubUsername: string | null;

  @ApiProperty()
  role: string;
}

export class ProbedServerAccessDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  subdomain: string;

  @ApiProperty()
  state: string;

  @ApiProperty()
  access_policy: string;

  @ApiProperty()
  is_maintenance: boolean;

  @ApiProperty()
  allowed: boolean;

  @ApiProperty()
  reason: string;

  @ApiProperty({ nullable: true })
  grantedBy: AccessGrantedBy | null;
}

export class IdentityProbeResultDto {
  @ApiProperty({ nullable: true })
  whois: NetworkIdentity | null;

  @ApiProperty({ type: ProbedUserDto, nullable: true })
  user: ProbedUserDto | null;

  @ApiProperty({
    enum: [
      'TAILSCALE_USER_ID',
      'NODE_ID',
      'SHARED_EMAIL',
      'SHARED_GITHUB',
      'PENDING_INVITE',
      'NONE',
    ],
  })
  matchedBy: IdentityMatchedBy;

  @ApiProperty()
  wouldBind: boolean;

  @ApiProperty({ nullable: true })
  nicknameCheck: NicknameDecisionResult | null;

  @ApiProperty({ type: [ProbedServerAccessDto] })
  servers: ProbedServerAccessDto[];
}
