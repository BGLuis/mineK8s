import { Module } from '@nestjs/common';
import { MinecraftSlpProbeService } from './minecraft-slp-probe.service';
import { GenericTcpProbeService } from './generic-tcp-probe.service';

@Module({
  providers: [MinecraftSlpProbeService, GenericTcpProbeService],
  exports: [MinecraftSlpProbeService, GenericTcpProbeService],
})
export class ProbesModule {}
