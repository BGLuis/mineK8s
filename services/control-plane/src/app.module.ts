import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { AppController } from './app.controller';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { RolesGuard } from './auth/roles.guard';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { LoggingModule } from './logging/logging.module';
import { KubernetesModule } from './k8s/k8s.module';
import { ServersModule } from './servers/servers.module';
import { ReconcilerModule } from './reconciler/reconciler.module';
import { TerminalModule } from './terminal/terminal.module';
import { TailscaleModule } from './tailscale/tailscale.module';
import { GatewayIpcModule } from './gateway-ipc/gateway-ipc.module';
import { AdminModule } from './admin/admin.module';
import { ProbesModule } from './probes/probes.module';
import { TasksModule } from './tasks/tasks.module';
import { ModpacksModule } from './modpacks/modpacks.module';
import { DnsModule } from './dns/dns.module';
import { ServerEventsModule } from './server-events/server-events.module';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    AuthModule,
    KubernetesModule,
    ServersModule,
    ReconcilerModule,
    TerminalModule,
    TailscaleModule,
    GatewayIpcModule,
    AdminModule,
    ProbesModule,
    TasksModule,
    ModpacksModule,
    DnsModule,
    ServerEventsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
