import { Module } from '@nestjs/common';
import { ServersService } from './servers.service';
import { ServersController } from './servers.controller';
import { UpdateService } from './update.service';
import { BackupsModule } from '../backups/backups.module';

@Module({
  imports: [BackupsModule],
  providers: [ServersService, UpdateService],
  controllers: [ServersController],
  exports: [ServersService], // exporta para SleepModeModule usar getPlayers via RCON
})
export class ServersModule {}

