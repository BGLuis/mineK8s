import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ServerStateSubscriber } from './server-state.subscriber';
import { ServersStateGateway } from './servers-state.gateway';

@Module({
  imports: [AuthModule],
  providers: [ServersStateGateway, ServerStateSubscriber],
})
export class ServerEventsModule {}
