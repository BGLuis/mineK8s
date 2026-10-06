import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from '@config/app-config.module';
import { Server } from '@database/entities/server.entity';
import { TailscaleDevice } from '@database/entities/tailscale-device.entity';

import { NodeController } from './node.controller';
import { NodeMetricsService } from './node-metrics.service';

@Module({
  imports: [TypeOrmModule.forFeature([Server, TailscaleDevice]), AppConfigModule],
  controllers: [NodeController],
  providers: [NodeMetricsService],
  exports: [NodeMetricsService],
})
export class NodeModule {}
