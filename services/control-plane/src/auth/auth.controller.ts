import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { BootstrapAdminDTO } from './dto/bootstrap-admin.dto';
import { LoginDTO } from './dto/login.dto';
import { Public } from './public.decorator';

@ApiTags('Authentication & Identity')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('bootstrap')
  @ApiOperation({
    summary: 'Initialize the primary administrator account using the ephemeral bootstrap token',
  })
  @ApiResponse({ status: 201, description: 'Primary administrator created successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired bootstrap token' })
  @ApiResponse({ status: 409, description: 'Minecraft nickname already registered' })
  async bootstrap(@Body() dto: BootstrapAdminDTO) {
    return this.authService.bootstrapAdmin(dto);
  }

  @Public()
  @Post('token')
  @ApiOperation({ summary: 'Obtain JWT token for registered user/administrator' })
  @ApiResponse({ status: 200, description: 'Token generated successfully' })
  @ApiResponse({ status: 401, description: 'User not found or credentials invalid' })
  async login(@Body() dto: LoginDTO) {
    return this.authService.login(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get profile of current authenticated user' })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getProfile(@Req() req: any) {
    return req.user;
  }
}
