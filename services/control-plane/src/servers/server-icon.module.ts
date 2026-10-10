import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from '@config/app-config.module';
import { Server } from '@database/entities/server.entity';

import { ServerIconService } from './server-icon.service';

@Module({
  imports: [TypeOrmModule.forFeature([Server]), AppConfigModule],
  providers: [ServerIconService],
  exports: [ServerIconService],
})
export class ServerIconModule {}
