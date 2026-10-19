import { Injectable, Logger } from '@nestjs/common';
import { TaskProgressPayload } from './tasks.gateway';

export interface TaskStateDto extends TaskProgressPayload {
  errorMessage: string | null;
  startedAt: Date;
  updatedAt: Date;
}

@Injectable()
export class TaskExecutionService {
  private readonly logger = new Logger(TaskExecutionService.name);
  private readonly tasks = new Map<string, TaskStateDto>();
  private readonly listeners = new Set<(task: TaskStateDto) => void>();
  private readonly cancelHandlers = new Map<string, () => Promise<void>>();

  public onProgress(listener: (task: TaskStateDto) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public registerCancelHandler(taskId: string, handler: () => Promise<void>): void {
    this.cancelHandlers.set(taskId, handler);
  }

  public async cancelTask(taskId: string): Promise<boolean> {
    const handler = this.cancelHandlers.get(taskId);
    if (handler) {
      this.cancelHandlers.delete(taskId);
      await handler();
      return true;
    }
    return false;
  }

  public register(
    task: Partial<TaskStateDto> & { taskId: string; serverId: string },
  ): TaskStateDto {
    const full: TaskStateDto = {
      taskId: task.taskId,
      serverId: task.serverId,
      status: task.status ?? 'IN_PROGRESS',
      progressPercent: task.progressPercent ?? 0,
      downloadedFiles: task.downloadedFiles ?? 0,
      totalFiles: task.totalFiles ?? 1,
      currentStep: task.currentStep ?? 'Iniciando tarefa...',
      errorMessage: task.errorMessage ?? null,
      speedBytesPerSec: task.speedBytesPerSec,
      freezeDurationMs: task.freezeDurationMs,
      startedAt: task.startedAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.tasks.set(task.taskId, full);
    this.notify(full);
    return full;
  }

  public update(taskId: string, patch: Partial<TaskStateDto>): TaskStateDto | null {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      return null;
    }
    const updated: TaskStateDto = {
      ...existing,
      ...patch,
      updatedAt: new Date(),
    };
    this.tasks.set(taskId, updated);
    this.notify(updated);
    return updated;
  }

  public getTask(taskId: string): TaskStateDto | null {
    return this.tasks.get(taskId) ?? null;
  }

  public clear(): void {
    this.tasks.clear();
  }

  private notify(task: TaskStateDto): void {
    for (const listener of this.listeners) {
      try {
        listener(task);
      } catch (err) {
        this.logger.error(`Error notifying task progress listener: ${(err as Error).message}`);
      }
    }
  }
}
