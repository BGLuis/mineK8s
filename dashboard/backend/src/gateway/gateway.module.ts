import { Module } from '@nestjs/common';
import { TailscaleModule } from '../tailscale/tailscale.module';
import { GatewayService } from './gateway.service';

@Module({
	imports: [TailscaleModule],
	providers: [GatewayService],
	exports: [GatewayService],
})
export class GatewayModule {}
