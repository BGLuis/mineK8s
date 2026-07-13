import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './app-config/app-config.module';
import { BackupsModule } from './backups/backups.module';
import { EncryptionModule } from './encryption/encryption.module';
import { GatewayModule } from './gateway/gateway.module';
import { LoggingModule } from './logging/logging.module';
import { ModpacksModule } from './modpacks/modpacks.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { PrismaModule } from './prisma/prisma.module';
import { ServersModule } from './servers/servers.module';
import { SleepModeModule } from './sleep-mode/sleep-mode.module';
import { TailscaleModule } from './tailscale/tailscale.module';

@Module({
	imports: [
		AppConfigModule,
		EncryptionModule,
		LoggingModule,
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
