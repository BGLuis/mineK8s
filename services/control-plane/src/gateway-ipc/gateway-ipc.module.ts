import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Server } from '@database/entities/server.entity';
import { ServerGroup } from '@database/entities/server-group.entity';
import { User } from '@database/entities/user.entity';
import { UserGroup } from '@database/entities/user-group.entity';
import { UserServerAccess } from '@database/entities/user-server-access.entity';

import { KubernetesModule } from '@k8s/k8s.module';

import { ServerIconModule } from '../servers/server-icon.module';
import { ServerActivityModule } from '../server-events/server-activity.module';
import { TailscaleModule } from '../tailscale/tailscale.module';

import { GatewayIpcController } from './gateway-ipc.controller';
import { GatewayIpcService } from './gateway-ipc.service';
import { PlayerSessionsService } from './player-sessions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Server, User, ServerGroup, UserGroup, UserServerAccess]),
    KubernetesModule,
    ServerActivityModule,
    ServerIconModule,
    // TailscaleModule também importa este módulo (DevicesService precisa do GatewayIpcService).
    forwardRef(() => TailscaleModule),
  ],
  controllers: [GatewayIpcController],
  providers: [GatewayIpcService, PlayerSessionsService],
  exports: [GatewayIpcService, PlayerSessionsService],
})
export class GatewayIpcModule {}
