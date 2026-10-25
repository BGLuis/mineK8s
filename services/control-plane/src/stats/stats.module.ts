import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from '@config/app-config.module';
import { ConsoleModule } from '@console/console.module';
import { Server } from '@database/entities/server.entity';
import { KubernetesModule } from '@k8s/k8s.module';

import { ServerActivityModule } from '../server-events/server-activity.module';
import { LagSnapshotService } from './lag-snapshot.service';
import { ServerStatsController } from './server-stats.controller';
import { ServerStatsService } from './server-stats.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Server]),
    AppConfigModule,
    KubernetesModule,
    ConsoleModule,
    ServerActivityModule,
  ],
  controllers: [ServerStatsController],
  providers: [ServerStatsService, LagSnapshotService],
})
export class StatsModule {}
