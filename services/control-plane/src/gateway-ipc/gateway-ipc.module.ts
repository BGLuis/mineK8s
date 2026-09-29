import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Server } from '@database/entities/server.entity';
import { ServerGroup } from '@database/entities/server-group.entity';
import { User } from '@database/entities/user.entity';
import { UserGroup } from '@database/entities/user-group.entity';
import { UserServerAccess } from '@database/entities/user-server-access.entity';

import { GatewayIpcController } from './gateway-ipc.controller';
import { GatewayIpcService } from './gateway-ipc.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Server, User, ServerGroup, UserGroup, UserServerAccess]),
  ],
  controllers: [GatewayIpcController],
  providers: [GatewayIpcService],
  exports: [GatewayIpcService],
})
export class GatewayIpcModule {}
