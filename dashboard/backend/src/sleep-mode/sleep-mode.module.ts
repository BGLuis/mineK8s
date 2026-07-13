import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { SleepModeController } from './sleep-mode.controller';
import { SleepModeService } from './sleep-mode.service';

@Module({
	imports: [ServersModule], // precisa do ServersService para chamar getPlayers via RCON
	providers: [SleepModeService],
	controllers: [SleepModeController],
})
export class SleepModeModule {}
