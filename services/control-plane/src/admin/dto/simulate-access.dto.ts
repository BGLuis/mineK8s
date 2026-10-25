import { ApiProperty } from '@nestjs/swagger';

export type AccessChangeItem =
  | { type: 'addUserToGroup'; userId: string; groupId: string }
  | { type: 'removeUserFromGroup'; userId: string; groupId: string }
  | { type: 'addServerToGroup'; serverId: string; groupId: string }
  | { type: 'removeServerFromGroup'; serverId: string; groupId: string }
  | { type: 'grantServer'; userId: string; serverId: string }
  | { type: 'revokeServer'; userId: string; serverId: string }
  | { type: 'deleteGroup'; groupId: string };

export class SimulateAccessDto {
  @ApiProperty({
    description: 'Lista de mudanças hipotéticas de acesso a simular',
  })
  changes: AccessChangeItem[];
}

export class SimulatedUserAccessResultDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  minecraftNick: string;

  @ApiProperty({ type: [String] })
  gains: string[];

  @ApiProperty({ type: [String] })
  losses: string[];

  @ApiProperty({ type: [String] })
  wouldBeKicked: string[];
}
