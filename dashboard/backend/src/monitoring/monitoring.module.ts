import { Module } from '@nestjs/common';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

@Module({
	providers: [MonitoringService],
	controllers: [MonitoringController],
	exports: [MonitoringService],
})
export class MonitoringModule {}
