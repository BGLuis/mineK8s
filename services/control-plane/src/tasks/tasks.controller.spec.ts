import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { ModpackTaskEntity, ModpackTaskStatus } from '@database/entities/modpack-task.entity';
import { TasksController } from './tasks.controller';
import { TaskExecutionService } from './task-execution.service';

const TASK_ID = '3f2b8c1e-5a47-4d0e-9c1b-7a6e2d4f8b90';

describe('TasksController: GET /api/tasks/:id', () => {
  let controller: TasksController;
  let taskRepo: { findOne: jest.Mock };

  beforeEach(() => {
    taskRepo = { findOne: jest.fn() };
    controller = new TasksController(taskRepo as unknown as Repository<ModpackTaskEntity>);
  });

  it('devolve o último estado salvo, no mesmo formato do evento taskProgress', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: TASK_ID,
      serverId: 'srv-1',
      status: ModpackTaskStatus.DOWNLOADING,
      progressPercent: 42,
      downloadedFiles: 21,
      totalFiles: 50,
      currentStep: 'Baixando mods',
      errorMessage: null,
      startedAt: new Date('2026-10-03T10:00:00Z'),
      updatedAt: new Date('2026-10-03T10:01:00Z'),
    });

    await expect(controller.getTask(TASK_ID)).resolves.toMatchObject({
      taskId: TASK_ID,
      serverId: 'srv-1',
      status: 'DOWNLOADING',
      progressPercent: 42,
      downloadedFiles: 21,
      totalFiles: 50,
      currentStep: 'Baixando mods',
      errorMessage: null,
    });
    expect(taskRepo.findOne).toHaveBeenCalledWith({ where: { id: TASK_ID } });
  });

  it('expõe a mensagem de erro de uma tarefa que falhou', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: TASK_ID,
      serverId: 'srv-1',
      status: ModpackTaskStatus.FAILED,
      progressPercent: 10,
      downloadedFiles: 1,
      totalFiles: 10,
      currentStep: 'Falhou',
      errorMessage: 'Hash divergente',
    });

    await expect(controller.getTask(TASK_ID)).resolves.toMatchObject({
      status: 'FAILED',
      errorMessage: 'Hash divergente',
    });
  });

  it('responde 404 quando a tarefa não existe', async () => {
    taskRepo.findOne.mockResolvedValue(null);

    await expect(controller.getTask(TASK_ID)).rejects.toThrow(NotFoundException);
  });

  it('responde 404, sem consultar o banco, para id que não é uuid', async () => {
    await expect(controller.getTask('restore-task-123')).rejects.toThrow(NotFoundException);
    expect(taskRepo.findOne).not.toHaveBeenCalled();
  });

  describe('POST /api/tasks/:id/cancel (#204)', () => {
    it('cancela a tarefa usando o TaskExecutionService', async () => {
      const mockTaskExecutionService = {
        getTask: jest.fn(),
        cancelTask: jest.fn().mockResolvedValue(true),
      };
      const customController = new TasksController(
        taskRepo as unknown as Repository<ModpackTaskEntity>,
        mockTaskExecutionService as unknown as TaskExecutionService,
      );

      const res = await customController.cancelTask('stop-task-1');
      expect(res).toEqual({ message: 'Task cancelled successfully', taskId: 'stop-task-1' });
      expect(mockTaskExecutionService.cancelTask).toHaveBeenCalledWith('stop-task-1');
    });

    it('responde 404 se a tarefa não for cancelável ou não existir', async () => {
      const mockTaskExecutionService = {
        getTask: jest.fn(),
        cancelTask: jest.fn().mockResolvedValue(false),
      };
      const customController = new TasksController(
        taskRepo as unknown as Repository<ModpackTaskEntity>,
        mockTaskExecutionService as unknown as TaskExecutionService,
      );

      await expect(customController.cancelTask('non-existent-task')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
