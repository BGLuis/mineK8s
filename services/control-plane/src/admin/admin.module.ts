import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Group } from '../database/entities/group.entity';
import { User } from '../database/entities/user.entity';
import { Server } from '../database/entities/server.entity';
import { UserGroup } from '../database/entities/user-group.entity';
import { ServerGroup } from '../database/entities/server-group.entity';
import { UserServerAccess } from '../database/entities/user-server-access.entity';

import { TailscaleModule } from '../tailscale/tailscale.module';
import { GatewayIpcModule } from '../gateway-ipc/gateway-ipc.module';
import { ConsoleModule } from '../console/console.module';
import { AppConfigModule } from '../config/app-config.module';
import { ServerIconModule } from '../servers/server-icon.module';

import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { MeController } from './me.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Group, User, Server, UserGroup, ServerGroup, UserServerAccess]),
    TailscaleModule,
    GatewayIpcModule,
    ConsoleModule,
    AppConfigModule,
    ServerIconModule,
  ],
  controllers: [AdminController, MeController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
