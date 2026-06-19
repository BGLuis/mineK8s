import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { v4 as uuidv4 } from 'uuid';
import { BackupsService } from '../backups/backups.service';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type UpdatePhase =
  | 'stopping'      // Desligando o servidor
  | 'backing-up'    // Criando backup de segurança
  | 'updating'      // Aplicando nova versão no Deployment
  | 'monitoring'    // Aguardando pod ficar Ready
  | 'success'       // Atualização concluída com sucesso
  | 'rolling-back'  // Rollback em andamento (update falhou)
  | 'rolled-back'   // Rollback concluído (update foi revertido)
  | 'failed';       // Falha crítica mesmo no rollback

export interface UpdateTask {
  taskId: string;
  serverId: string;
  targetVersion: string;
  source: 'CurseForge' | 'Modrinth';
  phase: UpdatePhase;
  backupFilename?: string;
  backupJobName?: string;
  message: string;
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
}

export class StartUpdateDto {
  version: string;
  source: 'CurseForge' | 'Modrinth';
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class UpdateService {
  private readonly logger = new Logger(UpdateService.name);
  private k8sAppsApi: k8s.AppsV1Api;
  private k8sCoreApi: k8s.CoreV1Api;
  private readonly namespace = 'default';

  // Store em memória das tasks ativas e recentes (persiste enquanto o processo rodar)
  private readonly tasks = new Map<string, UpdateTask>();

  constructor(private readonly backupsService: BackupsService) {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    this.k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
    this.k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);
  }

  // ---------------------------------------------------------------------------
  // Inicia o processo de update — retorna taskId imediatamente
  // ---------------------------------------------------------------------------
  startUpdate(serverId: string, dto: StartUpdateDto): UpdateTask {
    const taskId = uuidv4();
    const task: UpdateTask = {
      taskId,
      serverId,
      targetVersion: dto.version,
      source: dto.source,
      phase: 'stopping',
      message: 'Iniciando processo de atualização segura...',
      startedAt: new Date(),
    };

    this.tasks.set(taskId, task);

    // Executa em background — não bloqueia o request HTTP
    this.runUpdatePipeline(task).catch((err) => {
      this.logger.error(`Pipeline de update falhou de forma inesperada: ${err.message}`);
      this.setFailed(task, `Erro inesperado: ${err.message}`);
    });

    return task;
  }

  // ---------------------------------------------------------------------------
  // Retorna o estado atual de uma task
  // ---------------------------------------------------------------------------
  getTask(taskId: string): UpdateTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new HttpException(`Task "${taskId}" não encontrada.`, HttpStatus.NOT_FOUND);
    }
    return task;
  }

  // ---------------------------------------------------------------------------
  // Pipeline principal (roda em background)
  // ---------------------------------------------------------------------------
  private async runUpdatePipeline(task: UpdateTask): Promise<void> {
    const { serverId, source } = task;
    const versionEnvKey = source === 'CurseForge' ? 'CF_FILE_ID' : 'MODRINTH_VERSION';

    // ── FASE 1: Salva a versão atual do Deployment para rollback ──────────────
    let oldVersion: string | undefined;
    try {
      oldVersion = await this.getCurrentVersion(serverId, versionEnvKey);
      this.logger.log(`[update:${task.taskId}] Versão atual: ${oldVersion ?? 'não encontrada'}`);
    } catch {
      // Se não encontrar, prossegue sem rollback de versão (apenas de dados)
    }

    // ── FASE 2: Para o servidor ───────────────────────────────────────────────
    this.setPhase(task, 'stopping', 'Desligando servidor para backup seguro...');
    try {
      await this.scaleDeployment(serverId, 0);
      await this.waitForPodsToStop(serverId, 120_000); // espera pods sumirem (2min)
    } catch (err: any) {
      return this.setFailed(task, `Falha ao desligar o servidor: ${err.message}`);
    }

    // ── FASE 3: Cria backup e aguarda completar ───────────────────────────────
    this.setPhase(task, 'backing-up', 'Criando backup de segurança do mundo...');
    let backupFilename: string;
    try {
      const backupResult = await this.backupsService.createBackup(serverId);
      task.backupJobName = backupResult.jobName;
      task.backupFilename = backupResult.filename;
      backupFilename = backupResult.filename;

      const backupStatus = await this.backupsService.waitForJobCompletion(
        backupResult.jobName,
        10 * 60_000, // 10 minutos
      );

      if (backupStatus !== 'succeeded') {
        return this.setFailed(task, 'Backup falhou antes de iniciar a atualização. Servidor mantido offline.');
      }

      this.logger.log(`[update:${task.taskId}] Backup concluído: ${backupFilename}`);
    } catch (err: any) {
      return this.setFailed(task, `Erro no backup: ${err.message}`);
    }

    // ── FASE 4: Aplica nova versão e liga o servidor ──────────────────────────
    this.setPhase(task, 'updating', `Aplicando versão ${task.targetVersion}...`);
    try {
      await this.patchDeploymentVersion(serverId, versionEnvKey, task.targetVersion);
      await this.scaleDeployment(serverId, 1);
    } catch (err: any) {
      return this.triggerRollback(task, oldVersion, backupFilename, `Falha ao aplicar update: ${err.message}`);
    }

    // ── FASE 5: Monitora se o pod fica Ready ─────────────────────────────────
    this.setPhase(task, 'monitoring', 'Aguardando servidor iniciar com a nova versão (máx 10min)...');
    const podReady = await this.waitForPodReady(serverId, 10 * 60_000);

    if (podReady) {
      task.phase = 'success';
      task.message = `✅ Modpack atualizado para ${task.targetVersion} com sucesso! Backup salvo: ${backupFilename}`;
      task.finishedAt = new Date();
      this.logger.log(`[update:${task.taskId}] Update concluído com sucesso.`);
    } else {
      await this.triggerRollback(task, oldVersion, backupFilename, 'Pod não ficou Ready após 10 minutos.');
    }
  }

  // ---------------------------------------------------------------------------
  // Rollback: restaura dados + versão anterior
  // ---------------------------------------------------------------------------
  private async triggerRollback(
    task: UpdateTask,
    oldVersion: string | undefined,
    backupFilename: string,
    reason: string,
  ): Promise<void> {
    this.logger.warn(`[update:${task.taskId}] Iniciando rollback. Motivo: ${reason}`);
    this.setPhase(task, 'rolling-back', `Update falhou (${reason}). Restaurando backup automático...`);

    try {
      // Para o servidor com a versão problemática
      await this.scaleDeployment(task.serverId, 0);
      await this.waitForPodsToStop(task.serverId, 60_000);

      // Restaura os dados do backup
      const restoreResult = await this.backupsService.restoreBackup(task.serverId, backupFilename);
      await this.backupsService.waitForJobCompletion(restoreResult.jobName, 10 * 60_000);

      // Restaura a versão anterior no Deployment (se soubermos qual era)
      const versionEnvKey = task.source === 'CurseForge' ? 'CF_FILE_ID' : 'MODRINTH_VERSION';
      if (oldVersion) {
        await this.patchDeploymentVersion(task.serverId, versionEnvKey, oldVersion);
      }

      // Liga o servidor com a versão antiga
      await this.scaleDeployment(task.serverId, 1);

      task.phase = 'rolled-back';
      task.message = `⚠️ Update revertido automaticamente. Motivo: ${reason}. Servidor restaurado para o backup: ${backupFilename}`;
      task.finishedAt = new Date();
      task.error = reason;

      this.logger.warn(`[update:${task.taskId}] Rollback concluído.`);
    } catch (rollbackErr: any) {
      this.setFailed(task, `Rollback também falhou: ${rollbackErr.message}. Intervenção manual necessária!`);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers K8s
  // ---------------------------------------------------------------------------

  private async getCurrentVersion(serverId: string, envKey: string): Promise<string | undefined> {
    const deployment = await this.k8sAppsApi.readNamespacedDeployment({
      name: serverId,
      namespace: this.namespace,
    });
    const containers = deployment.spec?.template?.spec?.containers ?? [];
    const mc = containers.find((c) => c.name === 'minecraft');
    return mc?.env?.find((e) => e.name === envKey)?.value;
  }

  private async patchDeploymentVersion(
    serverId: string,
    envKey: string,
    value: string,
  ): Promise<void> {
    const deployment = await this.k8sAppsApi.readNamespacedDeployment({
      name: serverId,
      namespace: this.namespace,
    });

    const containers = deployment.spec?.template?.spec?.containers ?? [];
    const mc = containers.find((c) => c.name === 'minecraft');
    if (!mc) throw new Error(`Container 'minecraft' não encontrado no Deployment ${serverId}`);

    mc.env = mc.env ?? [];
    const existing = mc.env.find((e) => e.name === envKey);
    if (existing) {
      existing.value = value;
    } else {
      mc.env.push({ name: envKey, value });
    }

    await this.k8sAppsApi.replaceNamespacedDeployment({
      name: serverId,
      namespace: this.namespace,
      body: deployment,
    });
  }

  private async scaleDeployment(serverId: string, replicas: number): Promise<void> {
    const deployment = await this.k8sAppsApi.readNamespacedDeployment({
      name: serverId,
      namespace: this.namespace,
    });
    if (deployment.spec) deployment.spec.replicas = replicas;
    await this.k8sAppsApi.replaceNamespacedDeployment({
      name: serverId,
      namespace: this.namespace,
      body: deployment,
    });
  }

  /** Aguarda todos os pods do servidor sumirem (scale 0 completo) */
  private async waitForPodsToStop(serverId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3_000));
      const res = await this.k8sCoreApi.listNamespacedPod({
        namespace: this.namespace,
        labelSelector: `app=${serverId}`,
      });
      if (res.items.length === 0) return;
    }
    throw new Error(`Pods de ${serverId} não pararam em ${timeoutMs}ms`);
  }

  /**
   * Aguarda o pod entrar em Running e Ready.
   * Retorna false se detectar CrashLoopBackOff ou timeout.
   */
  private async waitForPodReady(serverId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10_000)); // checa a cada 10s
      try {
        const res = await this.k8sCoreApi.listNamespacedPod({
          namespace: this.namespace,
          labelSelector: `app=${serverId}`,
        });

        for (const pod of res.items) {
          const phase = pod.status?.phase;
          const containerStatuses = pod.status?.containerStatuses ?? [];

          // Detecta CrashLoopBackOff
          const crashed = containerStatuses.some(
            (cs) => cs.state?.waiting?.reason === 'CrashLoopBackOff'
              || cs.state?.waiting?.reason === 'Error'
              || (cs.restartCount ?? 0) >= 3,
          );
          if (crashed) {
            this.logger.warn(`[waitForPodReady] Pod ${pod.metadata?.name} em CrashLoopBackOff.`);
            return false;
          }

          // Pod Running e todos os containers Ready
          if (phase === 'Running' && containerStatuses.every((cs) => cs.ready)) {
            return true;
          }
        }
      } catch {
        // Ignora erros de leitura temporários
      }
    }

    return false; // timeout
  }

  // ---------------------------------------------------------------------------
  // Helpers de estado
  // ---------------------------------------------------------------------------

  private setPhase(task: UpdateTask, phase: UpdatePhase, message: string): void {
    task.phase = phase;
    task.message = message;
    this.logger.log(`[update:${task.taskId}] ${phase}: ${message}`);
  }

  private setFailed(task: UpdateTask, message: string): void {
    task.phase = 'failed';
    task.message = message;
    task.error = message;
    task.finishedAt = new Date();
    this.logger.error(`[update:${task.taskId}] FALHA: ${message}`);
  }
}
