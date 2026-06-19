import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ModpacksModule } from './modpacks/modpacks.module';
import { ServersModule } from './servers/servers.module';
import { TailscaleModule } from './tailscale/tailscale.module';
import { BackupsModule } from './backups/backups.module';
import { SleepModeModule } from './sleep-mode/sleep-mode.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { GatewayModule } from './gateway/gateway.module';
import { PrismaModule } from './prisma/prisma.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(), // habilita @Cron globalmente
    ModpacksModule,
    ServersModule,
    TailscaleModule,
    BackupsModule,
    SleepModeModule,
    MonitoringModule,
    GatewayModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

