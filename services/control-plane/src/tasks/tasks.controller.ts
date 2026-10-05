import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Repository } from 'typeorm';

import { Roles } from '@auth/roles.decorator';
import { UUID_PATTERN } from '@common/uuid';
import { ModpackTaskEntity } from '@database/entities/modpack-task.entity';
import { TaskProgressPayload } from './tasks.gateway';

export interface TaskStateDto extends TaskProgressPayload {
  errorMessage: string | null;
  startedAt: Date;
  updatedAt: Date;
}

@ApiTags('Tasks')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('api/tasks')
export class TasksController {
  constructor(
    @InjectRepository(ModpackTaskEntity)
    private readonly taskRepo: Repository<ModpackTaskEntity>,
  ) {}

  @Get(':id')
  @ApiOperation({
    summary:
      'Último estado conhecido de uma tarefa; permite retomar o progresso após recarregar a página',
  })
  @ApiResponse({ status: 200, description: 'Mesmo formato do evento taskProgress de /ws/tasks' })
  @ApiResponse({ status: 404, description: 'Tarefa não encontrada' })
  async getTask(@Param('id') id: string): Promise<TaskStateDto> {
    // Evita que o Postgres rejeite um id fora do formato uuid com erro 500.
    const task = UUID_PATTERN.test(id) ? await this.taskRepo.findOne({ where: { id } }) : null;
    if (!task) {
      throw new NotFoundException(`Task "${id}" not found`);
    }

    return {
      taskId: task.id,
      serverId: task.serverId,
      status: task.status,
      progressPercent: task.progressPercent,
      downloadedFiles: task.downloadedFiles,
      totalFiles: task.totalFiles,
      currentStep: task.currentStep,
      errorMessage: task.errorMessage ?? null,
      startedAt: task.startedAt,
      updatedAt: task.updatedAt,
    };
  }
}
