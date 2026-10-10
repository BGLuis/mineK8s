import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ServerActivityModule } from './server-activity.module';
import { ServerStateSubscriber } from './server-state.subscriber';
import { ServersStateGateway } from './servers-state.gateway';

@Module({
  imports: [AuthModule, ServerActivityModule],
  providers: [ServersStateGateway, ServerStateSubscriber],
})
export class ServerEventsModule {}
