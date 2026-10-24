import type { Repository } from 'typeorm';

import { AuthService } from '../auth/auth.service';
import { JwtService } from '../auth/jwt.service';
import { TrustedProxyService } from '../auth/trusted-proxy.service';
import { User } from '../database/entities/user.entity';
import { UserServerAccess } from '../database/entities/user-server-access.entity';

/**
 * Identifica o usuário de um socket Socket.IO (RF-RCON-14): Bearer JWT em `auth.token`, no header
 * `authorization` ou em `query.token`; senão, o header de identidade Tailscale, aceito só quando o
 * peer TCP do handshake é um proxy confiável (qualquer cliente consegue digitar o header).
 */
export async function authenticateSocket(
  client: any,
  authService: AuthService,
  jwtService: JwtService,
  trustedProxies: TrustedProxyService,
): Promise<User | null> {
  const handshake = client.handshake || {};
  const headers = handshake.headers || {};
  const auth = handshake.auth || {};
  const query = handshake.query || {};

  const rawToken =
    auth.token ||
    (headers['authorization']?.startsWith('Bearer ')
      ? headers['authorization'].substring(7).trim()
      : null) ||
    query.token;

  if (rawToken) {
    const payload = jwtService.verify(rawToken);
    if (payload?.sub) {
      return authService.validateUserById(payload.sub);
    }
  }

  const tailscaleHeader = headers['x-tailscale-user'];
  if (tailscaleHeader && trustedProxies.isTrusted(handshake.address)) {
    return authService.validateTailscaleUser(String(tailscaleHeader));
  }

  return null;
}

/**
 * Only admins can access server terminal and tasks websockets (#209).
 * user_server_access grants a player permission to join a Minecraft world
 * through the gateway, not operator access to the RCON console or background tasks.
 */
export async function canAccessServer(
  user: User | undefined,
  _serverId?: string,
  _accessRepo?: Repository<UserServerAccess>,
): Promise<boolean> {
  return user?.role === 'ADMIN';
}
