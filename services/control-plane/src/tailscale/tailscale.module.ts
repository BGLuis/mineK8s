import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Invite } from '../database/entities/invite.entity';
import { InviteGroup } from '../database/entities/invite-group.entity';
import { InviteServer } from '../database/entities/invite-server.entity';
import { User } from '../database/entities/user.entity';
import { UserGroup } from '../database/entities/user-group.entity';
import { UserServerAccess } from '../database/entities/user-server-access.entity';
import { TailscaleDevice } from '../database/entities/tailscale-device.entity';
import { Group } from '../database/entities/group.entity';
import { Server } from '../database/entities/server.entity';

import { ConsoleModule } from '../console/console.module';
import { GatewayIpcModule } from '../gateway-ipc/gateway-ipc.module';

import { TailscaleLocalDriver } from './drivers/tailscale-local.driver';
import { TailscaleCloudDriver } from './drivers/tailscale-cloud.driver';
import { TailscaleCompositeProvider } from './providers/tailscale-composite.provider';
import { NETWORK_IDENTITY_PROVIDER } from './identity/network-identity-provider.interface';
import { AccessDecisionEngineService } from './decision/access-decision-engine.service';
import { TailscalePostureService } from './posture/tailscale-posture.service';
import { InvitesService } from './invites/invites.service';
import { DevicesService } from './devices/devices.service';
import { TailscaleController } from './tailscale.controller';
import { JoinPortalController } from './portal/join-portal.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invite,
      InviteGroup,
      InviteServer,
      User,
      UserGroup,
      UserServerAccess,
      TailscaleDevice,
      Group,
      Server,
    ]),
    ConsoleModule,
    GatewayIpcModule,
  ],
  controllers: [TailscaleController, JoinPortalController],
  providers: [
    TailscalePostureService,
    TailscaleLocalDriver,
    TailscaleCloudDriver,
    TailscaleCompositeProvider,
    AccessDecisionEngineService,
    InvitesService,
    DevicesService,
    {
      provide: NETWORK_IDENTITY_PROVIDER,
      useExisting: TailscaleCompositeProvider,
    },
  ],
  exports: [
    TailscalePostureService,
    TailscaleLocalDriver,
    TailscaleCloudDriver,
    TailscaleCompositeProvider,
    AccessDecisionEngineService,
    InvitesService,
    DevicesService,
    NETWORK_IDENTITY_PROVIDER,
  ],
})
export class TailscaleModule {}
