import { Module } from '@nestjs/common';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';

@Module({
	controllers: [BackupsController],
	providers: [BackupsService],
	exports: [BackupsService], // exporta para o futuro módulo de Restauração usar
})
export class BackupsModule {}
