import { Module } from '@nestjs/common';

import { TailscaleLocalDriver } from './drivers/tailscale-local.driver';
import { TailscaleCloudDriver } from './drivers/tailscale-cloud.driver';
import { TailscaleCompositeProvider } from './providers/tailscale-composite.provider';
import { NETWORK_IDENTITY_PROVIDER } from './identity/network-identity-provider.interface';
import { AccessDecisionEngineService } from './decision/access-decision-engine.service';
import { TailscalePostureService } from './posture/tailscale-posture.service';
import { TailscaleController } from './tailscale.controller';

@Module({
  controllers: [TailscaleController],
  providers: [
    TailscalePostureService,
    TailscaleLocalDriver,
    TailscaleCloudDriver,
    TailscaleCompositeProvider,
    AccessDecisionEngineService,
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
    NETWORK_IDENTITY_PROVIDER,
  ],
})
export class TailscaleModule {}
