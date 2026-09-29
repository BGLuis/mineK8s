import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Server } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { KubernetesModule } from '@k8s/k8s.module';

import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Server, MinecraftServerSettings]),
    KubernetesModule,
  ],
  controllers: [ServersController],
  providers: [ServersService],
  exports: [ServersService],
})
export class ServersModule {}
