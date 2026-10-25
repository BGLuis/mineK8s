import { ApiProperty } from '@nestjs/swagger';
import type { AccessGrantedBy } from '../../tailscale/decision/access-resolver.service';

export class AccessMatrixUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  minecraftNick: string;

  @ApiProperty({ nullable: true })
  realName: string | null;

  @ApiProperty({ enum: ['ADMIN', 'PLAYER'] })
  role: 'ADMIN' | 'PLAYER';

  @ApiProperty({ type: [String] })
  groupIds: string[];
}

export class AccessMatrixServerDto {
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
}

export class AccessMatrixCellDto {
  @ApiProperty()
  allowed: boolean;

  @ApiProperty()
  reason: string;

  @ApiProperty({ nullable: true })
  grantedBy: AccessGrantedBy | null;
}

export class AccessMatrixDto {
  @ApiProperty({ type: [AccessMatrixUserDto] })
  users: AccessMatrixUserDto[];

  @ApiProperty({ type: [AccessMatrixServerDto] })
  servers: AccessMatrixServerDto[];

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'object',
      additionalProperties: {
        type: 'object',
      },
    },
  })
  cells: Record<string, Record<string, AccessMatrixCellDto>>;
}
