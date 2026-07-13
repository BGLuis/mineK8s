import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
	imports: [GatewayModule, PrismaModule],
	controllers: [AdminController],
	providers: [AdminService],
})
export class AdminModule {}
