import { Controller, Get, NotFoundException, Optional, Param, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Repository } from 'typeorm';

import { Roles } from '@auth/roles.decorator';
import { UUID_PATTERN } from '@common/uuid';
import { ModpackTaskEntity } from '@database/entities/modpack-task.entity';
import { TaskExecutionService, TaskStateDto } from './task-execution.service';

export { TaskStateDto };

@ApiTags('Tasks')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('api/tasks')
export class TasksController {
  constructor(
    @InjectRepository(ModpackTaskEntity)
    private readonly taskRepo: Repository<ModpackTaskEntity>,
    @Optional() private readonly taskExecutionService?: TaskExecutionService,
  ) {}

  @Get(':id')
  @ApiOperation({
    summary:
      'Último estado conhecido de uma tarefa; permite retomar o progresso após recarregar a página',
  })
  @ApiResponse({ status: 200, description: 'Mesmo formato do evento taskProgress de /ws/tasks' })
  @ApiResponse({ status: 404, description: 'Tarefa não encontrada' })
  async getTask(@Param('id') id: string): Promise<TaskStateDto> {
    const inMemory = this.taskExecutionService?.getTask(id);
    if (inMemory) {
      return inMemory;
    }

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

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancelar execução de uma tarefa ativa (#204)' })
  @ApiResponse({ status: 200, description: 'Tarefa cancelada' })
  @ApiResponse({ status: 404, description: 'Tarefa não encontrada ou não cancelável' })
  async cancelTask(@Param('id') id: string) {
    const cancelled = await this.taskExecutionService?.cancelTask(id);
    if (!cancelled) {
      throw new NotFoundException(`Task "${id}" not found or cannot be cancelled`);
    }
    return { message: 'Task cancelled successfully', taskId: id };
  }
}
