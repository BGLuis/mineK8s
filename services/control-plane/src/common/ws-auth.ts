import { AuthService } from '../auth/auth.service';
import { JwtService } from '../auth/jwt.service';
import { User } from '../database/entities/user.entity';

/**
 * Identifica o usuário de um socket Socket.IO (RF-RCON-14): Bearer JWT em `auth.token`, no header
 * `authorization` ou em `query.token`; senão, o header de identidade Tailscale.
 */
export async function authenticateSocket(
  client: any,
  authService: AuthService,
  jwtService: JwtService,
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
  if (tailscaleHeader) {
    return authService.validateTailscaleUser(String(tailscaleHeader));
  }

  return null;
}
