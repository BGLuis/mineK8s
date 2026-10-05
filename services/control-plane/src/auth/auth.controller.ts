import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { BootstrapAdminDTO } from './dto/bootstrap-admin.dto';
import { Public } from './public.decorator';
import { TrustedProxyService } from './trusted-proxy.service';

@ApiTags('Authentication & Identity')
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly trustedProxies: TrustedProxyService,
  ) {}

  @Public()
  @Post('bootstrap')
  @ApiOperation({
    summary: 'Initialize the primary administrator account using the ephemeral bootstrap token',
  })
  @ApiResponse({ status: 201, description: 'Primary administrator created successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired bootstrap token' })
  @ApiResponse({ status: 409, description: 'Minecraft nickname already registered' })
  async bootstrap(@Body() dto: BootstrapAdminDTO, @Req() req: any) {
    return this.authService.bootstrapAdmin(dto, this.clientIp(req));
  }

  @Public()
  @Post('session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Open a session for the Tailscale identity that owns the caller IP (no body, no nickname)',
  })
  @ApiResponse({
    status: 200,
    description: 'JWT issued for the account linked to the Tailscale identity',
  })
  @ApiResponse({
    status: 401,
    description: 'Caller is not on the tailnet or has no linked account',
  })
  @ApiResponse({ status: 503, description: 'Tailscale identity lookup is unavailable' })
  async createSession(@Req() req: any) {
    return this.authService.createSession(this.clientIp(req));
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get profile of current authenticated user' })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getProfile(@Req() req: any) {
    return req.user;
  }

  private clientIp(req: any): string | null {
    return this.trustedProxies.resolveClientIp(
      req.socket?.remoteAddress,
      req.headers?.['x-forwarded-for'],
    );
  }
}
