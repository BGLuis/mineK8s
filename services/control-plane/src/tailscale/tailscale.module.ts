import { Module } from '@nestjs/common';

import { TailscalePostureService } from './posture/tailscale-posture.service';
import { TailscaleController } from './tailscale.controller';

@Module({
  controllers: [TailscaleController],
  providers: [TailscalePostureService],
  exports: [TailscalePostureService],
})
export class TailscaleModule {}
