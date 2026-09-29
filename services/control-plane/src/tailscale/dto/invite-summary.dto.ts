import { ApiProperty } from '@nestjs/swagger';

export type InviteStatus = 'Active' | 'Depleted' | 'Expired' | 'Revoked';

/**
 * Representação resumida do convite e seu status de ciclo de vida (RF-TS-06).
 */
export class InviteSummaryDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'd9b73f8a0e2c418fb263914a87e50c4f' })
  token: string;

  @ApiProperty({ example: 'Galera do Discord' })
  name: string;

  @ApiProperty({ example: 5 })
  maxUses: number;

  @ApiProperty({ example: 2 })
  usedCount: number;

  @ApiProperty({ example: '2026-10-06T12:00:00.000Z' })
  expiresAt: Date;

  @ApiProperty({
    enum: ['Active', 'Depleted', 'Expired', 'Revoked'],
    example: 'Active',
  })
  status: InviteStatus;

  @ApiProperty({ example: 'https://mine.example.ts.net:3001/join?token=d9b73f8a0e2c418fb263914a87e50c4f' })
  joinUrl: string;

  @ApiProperty({ type: [String], example: ['b1a95e7c-88eb-4b2a-b60f-21f4df463e2a'] })
  groupIds: string[];

  @ApiProperty({ type: [String], example: ['c2b06f8d-99fc-4c3b-a71e-32e5ef574f3b'] })
  serverIds: string[];

  @ApiProperty({ example: '2026-09-29T12:00:00.000Z' })
  createdAt: Date;
}

/**
 * Calcula o status semântico do convite com base em seus atributos e tempo (RF-TS-06).
 */
export function computeInviteStatus(invite: {
  is_active: boolean;
  used_count: number;
  max_uses: number;
  expires_at: Date;
}): InviteStatus {
  if (!invite.is_active) {
    return 'Revoked';
  }
  if (invite.used_count >= invite.max_uses) {
    return 'Depleted';
  }
  if (new Date() > new Date(invite.expires_at)) {
    return 'Expired';
  }
  return 'Active';
}
