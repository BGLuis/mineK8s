import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Server } from '@database/entities/server.entity';
import { AppConfigModule } from '@config/app-config.module';

import { MinecraftSlpProbeService } from './minecraft-slp-probe.service';
import { GenericTcpProbeService } from './generic-tcp-probe.service';
import { HealthBotProbeService } from './health-bot-probe.service';
import { HealthBotSchedulerService } from './health-bot-scheduler.service';
import { HealthBotController } from './health-bot.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Server]),
    AppConfigModule,
  ],
  controllers: [HealthBotController],
  providers: [
    MinecraftSlpProbeService,
    GenericTcpProbeService,
    HealthBotProbeService,
    HealthBotSchedulerService,
  ],
  exports: [
    MinecraftSlpProbeService,
    GenericTcpProbeService,
    HealthBotProbeService,
    HealthBotSchedulerService,
  ],
})
export class ProbesModule {}
