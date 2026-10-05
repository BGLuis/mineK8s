import { Module } from '@nestjs/common';

import { AppConfigModule } from '../config/app-config.module';
import { DatabaseModule } from '../database/database.module';
import { TailscaleLocalDriver } from '../tailscale/drivers/tailscale-local.driver';
import { AdminLinkService } from './admin-link.service';

/** Only what the command needs: the full AppModule would also start the reconciler, gRPC and probes. */
@Module({
  imports: [AppConfigModule, DatabaseModule],
  providers: [AdminLinkService, TailscaleLocalDriver],
})
export class AdminLinkModule {}
