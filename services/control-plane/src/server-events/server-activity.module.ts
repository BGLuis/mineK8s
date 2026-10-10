import { Module } from '@nestjs/common';

import { ServerActivityBus } from './server-activity.bus';

@Module({
  providers: [ServerActivityBus],
  exports: [ServerActivityBus],
})
export class ServerActivityModule {}
