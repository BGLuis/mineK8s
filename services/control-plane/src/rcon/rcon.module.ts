import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { RconConnectionPool } from './pool/rcon-connection-pool';

@Module({
  imports: [AppConfigModule],
  providers: [RconConnectionPool],
  exports: [RconConnectionPool],
})
export class RconModule {}
