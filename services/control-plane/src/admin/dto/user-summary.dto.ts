import { ApiProperty } from '@nestjs/swagger';

export class UserDeviceSummaryDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ nullable: true, example: 'PC do Lucas' })
  deviceName: string | null;

  @ApiProperty({ enum: ['PENDING', 'ACTIVE', 'REVOKED'], example: 'ACTIVE' })
  status: string;

  @ApiProperty({ nullable: true, example: '2026-10-03T12:00:00.000Z' })
  lastSeenAt: Date | null;
}

export class UserSummaryDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'LucasCraft' })
  minecraftNick: string;

  @ApiProperty({ nullable: true, example: 'Lucas Henrique' })
  realName: string | null;

  @ApiProperty({
    nullable: true,
    example: 'lucas@example.com',
    description: 'E-mail da conta Tailscale',
  })
  email: string | null;

  @ApiProperty({
    nullable: true,
    example: 'jaoppb',
    description: 'Usuário do GitHub vinculado à conta Tailscale',
  })
  githubUsername: string | null;

  @ApiProperty({ description: 'A conta Tailscale já foi ligada ao cadastro no primeiro acesso' })
  linked: boolean;

  @ApiProperty({ enum: ['ADMIN', 'PLAYER'], example: 'PLAYER' })
  role: string;

  @ApiProperty({ type: [UserDeviceSummaryDto] })
  devices: UserDeviceSummaryDto[];

  @ApiProperty({ type: [String], example: ['b1a95e7c-88eb-4b2a-b60f-21f4df463e2a'] })
  groupIds: string[];
}

export class AccessibleServerDto {
  @ApiProperty({ example: 'b1a95e7c-88eb-4b2a-b60f-21f4df463e2a' })
  id: string;

  @ApiProperty({ example: 'Survival dos Amigos' })
  name: string;

  @ApiProperty({ example: 'survival' })
  subdomain: string;

  @ApiProperty({ example: 'READY' })
  state: string;
}
