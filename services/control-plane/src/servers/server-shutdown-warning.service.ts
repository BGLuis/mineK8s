import { ConflictException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CONSOLE_DRIVER_TOKEN, ConsoleDriver } from '@console/console-driver.interface';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { Server } from '@database/entities/server.entity';
import { TaskExecutionService } from '../tasks/task-execution.service';
import {
  DEFAULT_SERVER_LANGUAGE,
  formatCountdownCancelledMessage,
  formatCountdownMessage,
  ServerLanguage,
  ShutdownAction,
} from './server-language';

export { ShutdownAction };

export interface ScheduleCountdownOptions {
  server: Server;
  action: ShutdownAction;
  warningMinutes?: number;
  onExecute: () => Promise<void>;
}

export interface ScheduleCountdownResult {
  scheduled: boolean;
  taskId?: string;
}

interface ActiveCountdown {
  taskId: string;
  serverId: string;
  action: ShutdownAction;
  server: Server;
  language: ServerLanguage;
  cancel: () => Promise<void>;
}

/**
 * Calcula os marcos em segundos (<= totalSeconds) para o aviso por tellraw (RF-ARQ-08, #204).
 * Padrão: 10 min (600s), 5 min (300s), 1 min (60s), 30 s, 10 s.
 */
export function calculateMilestones(totalSeconds: number): number[] {
  if (totalSeconds <= 0) {
    return [];
  }
  const standard = [600, 300, 60, 30, 10];
  const strictlySmaller = standard.filter((s) => s < totalSeconds);
  return [totalSeconds, ...strictlySmaller];
}

@Injectable()
export class ServerShutdownWarningService {
  private readonly logger = new Logger(ServerShutdownWarningService.name);
  private readonly activeCountdowns = new Map<string, ActiveCountdown>();

  constructor(
    @Inject(CONSOLE_DRIVER_TOKEN)
    @Optional()
    private readonly consoleDriver?: ConsoleDriver,
    @Optional()
    private readonly taskExecutionService?: TaskExecutionService,
    @InjectRepository(MinecraftServerSettings)
    @Optional()
    private readonly settingsRepo?: Repository<MinecraftServerSettings>,
  ) {}

  public hasActiveCountdown(serverId: string): boolean {
    return this.activeCountdowns.has(serverId);
  }

  public getActiveCountdown(serverId: string): { taskId: string; action: ShutdownAction } | null {
    const active = this.activeCountdowns.get(serverId);
    if (!active) return null;
    return { taskId: active.taskId, action: active.action };
  }

  /**
   * Agenda contagem regressiva se o servidor tiver jogadores conectados e tempo de aviso > 0 (#204).
   * Devolve { scheduled: false } se não for necessário esperar (sem jogadores ou tempo = 0).
   */
  public async scheduleCountdown(
    options: ScheduleCountdownOptions,
  ): Promise<ScheduleCountdownResult> {
    const minutes =
      options.warningMinutes !== undefined
        ? options.warningMinutes
        : (options.server.stop_warning_minutes ?? 10);

    if (minutes <= 0) {
      return { scheduled: false };
    }

    if (!this.consoleDriver) {
      return { scheduled: false };
    }

    // 3. Pular a espera quando listPlayers volta vazio
    try {
      const players = await this.consoleDriver.listPlayers(options.server);
      if (!players || players.length === 0) {
        this.logger.log(
          `Sem jogadores online em [${options.server.subdomain}], parada imediata sem contagem (#204).`,
        );
        return { scheduled: false };
      }
    } catch (err) {
      this.logger.warn(
        `Não foi possível verificar jogadores online para [${options.server.subdomain}]: ${(err as Error).message}`,
      );
      return { scheduled: false };
    }

    if (this.activeCountdowns.has(options.server.id)) {
      throw new ConflictException(
        `Uma parada ou reinício já está agendado para o servidor [${options.server.subdomain}]`,
      );
    }

    const language = await this.resolveLanguage(options.server);
    const taskId = `${options.action}-warning-${options.server.id}-${Date.now()}`;
    const totalSeconds = minutes * 60;
    const initialStep = formatCountdownMessage(options.action, totalSeconds, language);

    this.taskExecutionService?.register({
      taskId,
      serverId: options.server.id,
      status: 'IN_PROGRESS',
      progressPercent: 0,
      currentStep: initialStep,
    });

    let timerHandle: NodeJS.Timeout | null = null;
    let isCancelled = false;

    const cancel = async () => {
      if (isCancelled) return;
      isCancelled = true;
      if (timerHandle) {
        clearTimeout(timerHandle);
        timerHandle = null;
      }
      this.activeCountdowns.delete(options.server.id);

      // Envia tellraw com cancelamento aos jogadores
      try {
        const cancelMsg = formatCountdownCancelledMessage(options.action, language);
        await this.consoleDriver?.sendCommand(
          options.server,
          `tellraw @a ${JSON.stringify({ text: cancelMsg, color: 'gold' })}`,
        );
      } catch (err) {
        this.logger.warn(`Erro ao enviar mensagem de cancelamento RCON: ${(err as Error).message}`);
      }

      this.taskExecutionService?.update(taskId, {
        status: 'FAILED',
        errorMessage: 'Operação cancelada',
        currentStep: 'Aviso de parada cancelado pelo administrador.',
      });
    };

    this.taskExecutionService?.registerCancelHandler(taskId, cancel);

    const countdownRecord: ActiveCountdown = {
      taskId,
      serverId: options.server.id,
      action: options.action,
      server: options.server,
      language,
      cancel,
    };
    this.activeCountdowns.set(options.server.id, countdownRecord);

    const milestones = calculateMilestones(totalSeconds);

    const runLoop = async () => {
      try {
        for (let i = 0; i < milestones.length; i++) {
          if (isCancelled) return;
          const currentSeconds = milestones[i];

          // 1. Envia tellraw para os jogadores
          try {
            const msg = formatCountdownMessage(options.action, currentSeconds, language);
            await this.consoleDriver?.sendCommand(
              options.server,
              `tellraw @a ${JSON.stringify({ text: msg, color: 'gold' })}`,
            );
          } catch (err) {
            this.logger.warn(`Erro ao enviar tellraw aos jogadores: ${(err as Error).message}`);
          }

          // 2. Atualiza progresso da task (/ws/tasks)
          const elapsed = totalSeconds - currentSeconds;
          const progressPercent = Math.min(99, Math.round((elapsed / totalSeconds) * 100));
          const stepMsg = formatCountdownMessage(options.action, currentSeconds, language);
          this.taskExecutionService?.update(taskId, {
            progressPercent,
            currentStep: stepMsg,
          });

          // 3. Aguarda até o próximo marco (ou 0s)
          const nextSeconds = i + 1 < milestones.length ? milestones[i + 1] : 0;
          const waitMs = (currentSeconds - nextSeconds) * 1000;

          if (waitMs > 0) {
            await new Promise<void>((resolve) => {
              timerHandle = setTimeout(() => {
                timerHandle = null;
                resolve();
              }, waitMs);
            });
          }

          if (isCancelled) return;

          // Se todos os jogadores saíram durante a contagem, encerra espera e procede
          try {
            const remainingPlayers = await this.consoleDriver?.listPlayers(options.server);
            if (!remainingPlayers || remainingPlayers.length === 0) {
              this.logger.log(
                `Todos os jogadores saíram de [${options.server.subdomain}], adiantando parada (#204).`,
              );
              break;
            }
          } catch {
            // Segue contagem normal se a checagem falhar
          }
        }

        if (isCancelled) return;

        this.activeCountdowns.delete(options.server.id);

        this.taskExecutionService?.update(taskId, {
          progressPercent: 99,
          currentStep: 'Executando parada do servidor...',
        });

        // 4. Executa a ação real (stopServer, restartServer, updateVersion pipeline)
        await options.onExecute();

        this.taskExecutionService?.update(taskId, {
          status: 'COMPLETED',
          progressPercent: 100,
          currentStep: 'Operação concluída com sucesso.',
        });
      } catch (err) {
        this.logger.error(
          `Falha durante execução pós-contagem em [${options.server.subdomain}]: ${(err as Error).message}`,
        );
        this.taskExecutionService?.update(taskId, {
          status: 'FAILED',
          errorMessage: (err as Error).message,
        });
        this.activeCountdowns.delete(options.server.id);
      }
    };

    void runLoop();

    return { scheduled: true, taskId };
  }

  public async cancelCountdown(serverId: string): Promise<boolean> {
    const active = this.activeCountdowns.get(serverId);
    if (!active) {
      return false;
    }
    await active.cancel();
    return true;
  }

  public async cancelTask(taskId: string): Promise<boolean> {
    for (const active of this.activeCountdowns.values()) {
      if (active.taskId === taskId) {
        await active.cancel();
        return true;
      }
    }
    return false;
  }

  private async resolveLanguage(server: Server): Promise<ServerLanguage> {
    if (server.minecraft_settings?.language) {
      return server.minecraft_settings.language as ServerLanguage;
    }
    if (this.settingsRepo) {
      try {
        const settings = await this.settingsRepo.findOne({ where: { server_id: server.id } });
        if (settings?.language) {
          return settings.language as ServerLanguage;
        }
      } catch {
        // Fallback para o padrão
      }
    }
    return DEFAULT_SERVER_LANGUAGE;
  }
}
