import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthService } from './auth.service';
import { JwtService } from './jwt.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { TrustedProxyService } from './trusted-proxy.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly trustedProxies: TrustedProxyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    // 1. Bearer JWT Token
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      const payload = this.jwtService.verify(token);

      if (payload) {
        const user = await this.authService.validateUserById(payload.sub);
        if (user) {
          request.user = user;
          return true;
        }
      }
    }

    // 2. Tailscale identity header: anyone can type it, so it only counts when a trusted proxy sent it.
    const tailscaleUserHeader = request.headers['x-tailscale-user'];
    if (tailscaleUserHeader && this.trustedProxies.isTrusted(request.socket?.remoteAddress)) {
      const user = await this.authService.validateTailscaleUser(
        String(tailscaleUserHeader),
      );
      if (user) {
        request.user = user;
        return true;
      }
    }

    throw new UnauthorizedException('Access denied: missing or invalid credential');
  }
}
