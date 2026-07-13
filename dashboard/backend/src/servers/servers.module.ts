import { Module } from '@nestjs/common';
import { BackupsModule } from '../backups/backups.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { UpdateService } from './update.service';

@Module({
	imports: [BackupsModule, PrismaModule],
	providers: [ServersService, UpdateService],
	controllers: [ServersController],
	exports: [ServersService], // exporta para SleepModeModule usar getPlayers via RCON
})
export class ServersModule {}
