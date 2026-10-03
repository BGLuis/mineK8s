import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ModpackTaskEntity } from '@database/entities/modpack-task.entity';
import { TasksController } from './tasks.controller';
import { TasksGateway } from './tasks.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([ModpackTaskEntity])],
  controllers: [TasksController],
  providers: [TasksGateway],
  exports: [TasksGateway],
})
export class TasksModule {}
