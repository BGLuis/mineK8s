import { Module } from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { TailscaleModule } from '../tailscale/tailscale.module';

@Module({
  imports: [TailscaleModule],
  providers: [GatewayService],
  exports: [GatewayService],
})
export class GatewayModule {}
