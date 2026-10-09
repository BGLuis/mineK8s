import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from '@config/app-config.module';
import { ConsoleModule } from '@console/console.module';
import { Server } from '@database/entities/server.entity';
import { KubernetesModule } from '@k8s/k8s.module';

import { ServerStatsController } from './server-stats.controller';
import { ServerStatsService } from './server-stats.service';

@Module({
  imports: [TypeOrmModule.forFeature([Server]), AppConfigModule, KubernetesModule, ConsoleModule],
  controllers: [ServerStatsController],
  providers: [ServerStatsService],
})
export class StatsModule {}
