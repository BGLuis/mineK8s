import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Server } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { ServerAuditLog } from '@database/entities/server-audit-log.entity';
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
import { MinecraftStorageProvider } from './providers/minecraft-storage.provider';
import { GameStorageProviderRegistry } from './providers/game-storage-provider.registry';

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
  providers: [
    ServersService,
    ServersFilesService,
    ServersBackupService,
    MinecraftStorageProvider,
    GameStorageProviderRegistry,
  ],
  exports: [
    ServersService,
    ServersFilesService,
    ServersBackupService,
    MinecraftStorageProvider,
    GameStorageProviderRegistry,
  ],
})
export class ServersModule {}
