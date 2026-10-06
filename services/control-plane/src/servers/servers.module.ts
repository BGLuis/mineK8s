import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Server } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { ServerAuditLog } from '@database/entities/server-audit-log.entity';
import { ServerBackupEntity } from '@database/entities/server-backup.entity';
import { ModpackTaskEntity } from '@database/entities/modpack-task.entity';
import { AppConfigModule } from '@config/app-config.module';
import { KubernetesModule } from '@k8s/k8s.module';
import { ConsoleModule } from '@console/console.module';
import { LoggingModule } from '@logging/logging.module';
import { ProbesModule } from '../probes/probes.module';
import { GatewayIpcModule } from '../gateway-ipc/gateway-ipc.module';
import { DnsModule } from '../dns/dns.module';
import { NodeModule } from '../node/node.module';

import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { ServersFilesService } from './servers-files.service';
import { ServersBackupService } from './servers-backup.service';
import { MinecraftStorageProvider } from './providers/minecraft-storage.provider';
import { GameStorageProviderRegistry } from './providers/game-storage-provider.registry';
import { ServerRuntimeResolver } from './runtime/server-runtime.resolver';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Server,
      MinecraftServerSettings,
      ServerAuditLog,
      ServerBackupEntity,
      ModpackTaskEntity,
    ]),
    AppConfigModule,
    KubernetesModule,
    ConsoleModule,
    LoggingModule,
    ProbesModule,
    GatewayIpcModule,
    DnsModule,
    NodeModule,
  ],
  controllers: [ServersController],
  providers: [
    ServersService,
    ServersFilesService,
    ServersBackupService,
    MinecraftStorageProvider,
    GameStorageProviderRegistry,
    ServerRuntimeResolver,
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
