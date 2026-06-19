import { Module } from '@nestjs/common';
import { SleepModeService } from './sleep-mode.service';
import { SleepModeController } from './sleep-mode.controller';
import { ServersModule } from '../servers/servers.module';

@Module({
  imports: [ServersModule], // precisa do ServersService para chamar getPlayers via RCON
  providers: [SleepModeService],
  controllers: [SleepModeController],
})
export class SleepModeModule {}
