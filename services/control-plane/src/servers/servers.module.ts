import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Server } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { AppConfigModule } from '@config/app-config.module';
import { KubernetesModule } from '@k8s/k8s.module';
import { ConsoleModule } from '@console/console.module';
import { LoggingModule } from '@logging/logging.module';
import { ProbesModule } from '../probes/probes.module';
import { GatewayIpcModule } from '../gateway-ipc/gateway-ipc.module';

import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { ServersFilesService } from './servers-files.service';
import { ServersBackupService } from './servers-backup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Server, MinecraftServerSettings, ServerAuditLog]),
    AppConfigModule,
    KubernetesModule,
    ConsoleModule,
    LoggingModule,
    ProbesModule,
    GatewayIpcModule,
  ],
  controllers: [ServersController],
  providers: [ServersService, ServersFilesService, ServersBackupService],
  exports: [ServersService, ServersFilesService, ServersBackupService],
})
export class ServersModule {}
