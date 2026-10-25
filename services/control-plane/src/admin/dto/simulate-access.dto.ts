import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsUUID, ValidateNested } from 'class-validator';

export const ACCESS_CHANGE_TYPES = [
  'addUserToGroup',
  'removeUserFromGroup',
  'addServerToGroup',
  'removeServerFromGroup',
  'grantServer',
  'revokeServer',
  'deleteGroup',
] as const;

export type AccessChangeType = (typeof ACCESS_CHANGE_TYPES)[number];

export class AccessChangeItemDto {
  @ApiProperty({
    enum: ACCESS_CHANGE_TYPES,
    description: 'Tipo da mudança hipotética de acesso',
  })
  @IsIn(ACCESS_CHANGE_TYPES)
  type: AccessChangeType;

  @ApiProperty({ required: false, description: 'ID do usuário (UUID)' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ required: false, description: 'ID do grupo (UUID)' })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiProperty({ required: false, description: 'ID do servidor (UUID)' })
  @IsOptional()
  @IsUUID()
  serverId?: string;
}

export type AccessChangeItem = AccessChangeItemDto;

export class SimulateAccessDto {
  @ApiProperty({
    description: 'Lista de mudanças hipotéticas de acesso a simular',
    type: [AccessChangeItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccessChangeItemDto)
  changes: AccessChangeItemDto[];
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
