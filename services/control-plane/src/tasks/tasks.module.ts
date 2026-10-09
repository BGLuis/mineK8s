import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ModpackTaskEntity } from '@database/entities/modpack-task.entity';
import { UserServerAccess } from '@database/entities/user-server-access.entity';
import { TasksController } from './tasks.controller';
import { TasksGateway } from './tasks.gateway';
import { TaskExecutionService } from './task-execution.service';

@Module({
  imports: [TypeOrmModule.forFeature([ModpackTaskEntity, UserServerAccess])],
  controllers: [TasksController],
  providers: [TasksGateway, TaskExecutionService],
  exports: [TasksGateway, TaskExecutionService],
})
export class TasksModule {}
