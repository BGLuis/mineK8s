import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Server } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { ServerAuditLog } from '@database/entities/server-audit-log.entity';
import { KubernetesModule } from '@k8s/k8s.module';
import { ConsoleModule } from '@console/console.module';
import { LoggingModule } from '@logging/logging.module';

import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { ServersFilesService } from './servers-files.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Server, MinecraftServerSettings, ServerAuditLog]),
    KubernetesModule,
    ConsoleModule,
    LoggingModule,
  ],
  controllers: [ServersController],
  providers: [ServersService, ServersFilesService],
  exports: [ServersService, ServersFilesService],
})
export class ServersModule {}
