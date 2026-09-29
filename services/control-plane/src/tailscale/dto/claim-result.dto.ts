import { ApiProperty } from '@nestjs/swagger';

export class TailcatTunnelInfo {
  @ApiProperty({ example: 'survival.mine.lan:25565' })
  serverAddress: string;

  @ApiProperty({ example: 'Execute o binário portátil tailcat ou conecte via 127.0.0.1:25565' })
  instructions: string;
}

/**
 * Resposta de sucesso do resgate de convite (RF-TS-08, RF-TS-11).
 */
export class ClaimResultDto {
  @ApiProperty({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  userId: string;

  @ApiProperty({ example: 'Lucas Henrique' })
  realName: string;

  @ApiProperty({ example: 'LucasCraft' })
  minecraftNick: string;

  @ApiProperty({ example: 'tskey-auth-kXXXXX-YYYYY' })
  authKey: string;

  @ApiProperty({ example: 'tailscale://login?key=tskey-auth-kXXXXX-YYYYY' })
  deepLinkUrl: string;

  @ApiProperty({ type: TailcatTunnelInfo, required: false })
  tailcatTunnel?: TailcatTunnelInfo;

  @ApiProperty({ example: '2026-10-06T12:00:00.000Z' })
  expiresAt: string;
}
