import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '@database/entities/user.entity';

import { TailscaleModule } from '../tailscale/tailscale.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { JwtService } from './jwt.service';
import { RolesGuard } from './roles.guard';
import { TrustedProxyService } from './trusted-proxy.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User]), TailscaleModule],
  controllers: [AuthController],
  providers: [AuthService, JwtService, TrustedProxyService, AuthGuard, RolesGuard],
  exports: [AuthService, JwtService, TrustedProxyService, AuthGuard, RolesGuard],
})
export class AuthModule {}
