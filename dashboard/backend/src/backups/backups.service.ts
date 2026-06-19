import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface BackupFile {
  filename: string;
  serverId: string;
  createdAt: Date;
  sizeMb: number | null;
}

export interface BackupJobResult {
  jobName: string;
  filename: string;
  message: string;
}

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'unknown';

export interface RestoreJobResult {
  jobName: string;
  filename: string;
  message: string;
}

@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);
  private k8sBatch: k8s.BatchV1Api;
  private k8sCore: k8s.CoreV1Api;
  private k8sApps: k8s.AppsV1Api;
  private readonly namespace = 'default';
  private readonly BACKUP_PVC = 'global-backups-pvc';

  constructor() {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    this.k8sBatch = kc.makeApiClient(k8s.BatchV1Api);
    this.k8sCore = kc.makeApiClient(k8s.CoreV1Api);
    this.k8sApps = kc.makeApiClient(k8s.AppsV1Api);
  }

  // ---------------------------------------------------------------------------
  // Garante que o PVC global de backups existe — cria se necessário
  // ---------------------------------------------------------------------------
  async ensureBackupPvc(): Promise<void> {
    try {
      await this.k8sCore.readNamespacedPersistentVolumeClaim({
        name: this.BACKUP_PVC,
        namespace: this.namespace,
      });
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.response?.statusCode === 404) {
        this.logger.log(`PVC "${this.BACKUP_PVC}" não existe — criando...`);
        await this.k8sCore.createNamespacedPersistentVolumeClaim({
          namespace: this.namespace,
          body: {
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: { name: this.BACKUP_PVC },
            spec: {
              accessModes: ['ReadWriteOnce'],
              storageClassName: 'local-path',
              resources: { requests: { storage: '50Gi' } },
            },
          },
        });
        this.logger.log(`PVC "${this.BACKUP_PVC}" criado com 50Gi.`);
      } else {
        throw e;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Dispara um K8s Job que comprime /data do servidor em .tar.gz
  // ---------------------------------------------------------------------------
  async createBackup(serverId: string): Promise<BackupJobResult> {
    await this.ensureBackupPvc();

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .toLowerCase();

    // Nome do job limitado a 63 chars (limite do K8s)
    const jobName = `backup-${serverId}-${timestamp}`.substring(0, 63);
    const filename = `${serverId}-${timestamp}.tar.gz`;
    // Organiza por servidor: /backups/{serverId}/{filename}
    const backupPath = `/backups/${serverId}/${filename}`;

    const job: k8s.V1Job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: jobName, namespace: this.namespace },
      spec: {
        ttlSecondsAfterFinished: 86_400, // auto-limpa o Job após 24h
        template: {
          spec: {
            restartPolicy: 'Never',
            initContainers: [
              {
                // Garante que o diretório do servidor existe no PVC de backup
                name: 'mkdir',
                image: 'alpine',
                command: ['sh', '-c', `mkdir -p /backups/${serverId}`],
                volumeMounts: [{ name: 'backup-volume', mountPath: '/backups' }],
              },
            ],
            containers: [
              {
                name: 'compressor',
                image: 'alpine',
                command: ['/bin/sh', '-c'],
                args: [
                  // Comprime TODO o /data (mundo + configs) exceto logs e cache
                  `tar -czvf ${backupPath} --exclude='/data/logs' --exclude='/data/crash-reports' -C / data`,
                ],
                volumeMounts: [
                  { name: 'data-volume', mountPath: '/data', readOnly: true },
                  { name: 'backup-volume', mountPath: '/backups' },
                ],
              },
            ],
            volumes: [
              {
                name: 'data-volume',
                persistentVolumeClaim: { claimName: `${serverId}-pvc` },
              },
              {
                name: 'backup-volume',
                persistentVolumeClaim: { claimName: this.BACKUP_PVC },
              },
            ],
          },
        },
      },
    };

    try {
      await this.k8sBatch.createNamespacedJob({
        namespace: this.namespace,
        body: job,
      });
      this.logger.log(`Job de backup "${jobName}" criado para o servidor "${serverId}".`);

      return {
        jobName,
        filename,
        message: `Backup iniciado. Acompanhe o status em GET /api/servers/${serverId}/backup/status/${jobName}`,
      };
    } catch (error: any) {
      this.logger.error(`Falha ao criar job de backup: ${error.message}`);
      throw new HttpException(
        `Falha ao iniciar o backup: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Retorna o status atual de um Job de backup
  // ---------------------------------------------------------------------------
  async getJobStatus(jobName: string): Promise<{ status: JobStatus; message: string }> {
    try {
      const job = await this.k8sBatch.readNamespacedJob({
        name: jobName,
        namespace: this.namespace,
      });

      const conditions = job.status?.conditions ?? [];
      const succeeded = job.status?.succeeded ?? 0;
      const failed = job.status?.failed ?? 0;
      const active = job.status?.active ?? 0;

      if (succeeded > 0) {
        return { status: 'succeeded', message: 'Backup concluído com sucesso.' };
      }
      if (failed > 0) {
        const reason = conditions.find((c) => c.type === 'Failed')?.message ?? 'Falha desconhecida.';
        return { status: 'failed', message: `Backup falhou: ${reason}` };
      }
      if (active > 0) {
        return { status: 'running', message: 'Backup em andamento...' };
      }

      return { status: 'unknown', message: 'Job existe mas ainda não iniciou.' };
    } catch (error: any) {
      throw new HttpException(
        `Job "${jobName}" não encontrado.`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Restaura um backup: limpa /data e extrai o .tar.gz
  // ⚠️  O servidor DEVE estar offline (replicas=0) antes de restaurar.
  // ---------------------------------------------------------------------------
  async restoreBackup(serverId: string, filename: string): Promise<RestoreJobResult> {
    // --- Validação do filename: previne path traversal ---
    const safeFilename = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '');
    if (!safeFilename.endsWith('.tar.gz') || !safeFilename.startsWith(serverId)) {
      throw new HttpException(
        'Nome de arquivo de backup inválido.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // --- Garante que o servidor está offline ---
    await this.assertServerIsOffline(serverId);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').toLowerCase();
    const jobName = `restore-${serverId}-${timestamp}`.substring(0, 63);
    const backupPath = `/backups/${serverId}/${safeFilename}`;

    const job: k8s.V1Job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: jobName, namespace: this.namespace },
      spec: {
        ttlSecondsAfterFinished: 86_400,
        template: {
          spec: {
            restartPolicy: 'Never',
            initContainers: [
              {
                // Limpa o /data atual antes de restaurar
                name: 'clear-data',
                image: 'alpine',
                command: [
                  'sh', '-c',
                  // Remove tudo EXCETO a pasta perdida+found (do sistema de arquivos)
                  `find /data -mindepth 1 -not -path '/data/lost+found' -delete`,
                ],
                volumeMounts: [{ name: 'data-volume', mountPath: '/data' }],
              },
            ],
            containers: [
              {
                name: 'extractor',
                image: 'alpine',
                command: ['/bin/sh', '-c'],
                args: [
                  // --strip-components=1 remove o prefixo 'data/' do backup
                  // resultado: data/world/... → /data/world/...
                  `tar -xzvf ${backupPath} --strip-components=1 -C /data && echo "Restauração concluída."`,
                ],
                volumeMounts: [
                  { name: 'data-volume', mountPath: '/data' },
                  { name: 'backup-volume', mountPath: '/backups', readOnly: true },
                ],
              },
            ],
            volumes: [
              {
                name: 'data-volume',
                persistentVolumeClaim: { claimName: `${serverId}-pvc` },
              },
              {
                name: 'backup-volume',
                persistentVolumeClaim: { claimName: this.BACKUP_PVC },
              },
            ],
          },
        },
      },
    };

    try {
      await this.k8sBatch.createNamespacedJob({
        namespace: this.namespace,
        body: job,
      });
      this.logger.log(`Job de restauração "${jobName}" criado para o servidor "${serverId}" a partir de "${safeFilename}".`);

      return {
        jobName,
        filename: safeFilename,
        message: `Restauração iniciada. Acompanhe em GET /api/servers/${serverId}/backup/status/${jobName}`,
      };
    } catch (error: any) {
      this.logger.error(`Falha ao criar job de restauração: ${error.message}`);
      throw new HttpException(
        `Falha ao iniciar a restauração: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Verifica que o deployment está com replicas=0 (segurança antes do restore)
  // ---------------------------------------------------------------------------
  private async assertServerIsOffline(serverId: string): Promise<void> {
    try {
      const deployment = await this.k8sApps.readNamespacedDeployment({
        name: serverId,
        namespace: this.namespace,
      });
      const replicas = deployment.spec?.replicas ?? 0;
      if (replicas > 0) {
        throw new HttpException(
          `O servidor "${serverId}" está online (replicas=${replicas}). ` +
          `Desligue-o antes de restaurar um backup para evitar corrupção de dados.`,
          HttpStatus.CONFLICT,
        );
      }
    } catch (e: any) {
      // Repropaga HttpException (servidor online), ignora erro de "não encontrado"
      if (e instanceof HttpException) throw e;
      // Se o deployment não existe, prossegue (restaurar em PVC sem servidor rodando é seguro)
    }
  }

  // ---------------------------------------------------------------------------
  // Lista os backups disponíveis para um servidor específico
  // ---------------------------------------------------------------------------
  async listBackups(serverId: string): Promise<BackupFile[]> {
    // Roda um pod temporário que monta o PVC de backups e lista o diretório do servidor
    const podName = `backup-ls-${Date.now()}`;

    const pod: k8s.V1Pod = {
      metadata: { name: podName, namespace: this.namespace },
      spec: {
        restartPolicy: 'Never',
        containers: [
          {
            name: 'ls',
            image: 'alpine',
            command: [
              'sh', '-c',
              `ls -la /backups/${serverId}/ 2>/dev/null && echo "---DONE---" || echo "NO_BACKUPS---DONE---"`,
            ],
            volumeMounts: [{ name: 'bk', mountPath: '/backups' }],
          },
        ],
        volumes: [
          {
            name: 'bk',
            persistentVolumeClaim: { claimName: this.BACKUP_PVC },
          },
        ],
      },
    };

    try {
      await this.k8sCore.createNamespacedPod({ namespace: this.namespace, body: pod });

      // Aguarda o pod completar (máx 30s)
      const logs = await this.waitForPodAndGetLogs(podName, 30_000);

      return this.parseBackupListing(logs, serverId);
    } catch (error: any) {
      this.logger.error(`listBackups error: ${error.message}`);
      // Se o PVC não existe ainda, retorna lista vazia (nenhum backup ainda)
      return [];
    } finally {
      // Limpa o pod temporário
      await this.k8sCore
        .deleteNamespacedPod({ name: podName, namespace: this.namespace })
        .catch(() => {}); // ignora erros de cleanup
    }
  }

  // ---------------------------------------------------------------------------
  // Aguarda um K8s Job completar — público para uso pelo UpdateService
  // ---------------------------------------------------------------------------
  async waitForJobCompletion(
    jobName: string,
    timeoutMs: number,
  ): Promise<'succeeded' | 'failed'> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3_000));
      const { status } = await this.getJobStatus(jobName);
      if (status === 'succeeded') return 'succeeded';
      if (status === 'failed') return 'failed';
    }

    return 'failed'; // timeout → trata como falha
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  private async waitForPodAndGetLogs(podName: string, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    const interval = 2_000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      try {
        const pod = await this.k8sCore.readNamespacedPod({
          name: podName,
          namespace: this.namespace,
        });
        const phase = pod.status?.phase;
        if (phase === 'Succeeded' || phase === 'Failed') {
          const logs = await this.k8sCore.readNamespacedPodLog({
            name: podName,
            namespace: this.namespace,
          });
          return String(logs);
        }
      } catch {
        // pod pode ainda não existir — continua polling
      }
    }

    throw new Error(`Pod ${podName} não completou em ${timeoutMs}ms`);
  }

  /** Parseia a saída do `ls -la` em objetos BackupFile */
  private parseBackupListing(raw: string, serverId: string): BackupFile[] {
    if (!raw || raw.includes('NO_BACKUPS')) return [];

    const files: BackupFile[] = [];
    const lines = raw.split('\n').filter((l) => l.includes('.tar.gz'));

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const filename = parts.slice(8).join(' ');
      // Formato esperado: mc-survival-abc-2026-06-12t08-30-00-000z.tar.gz
      const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}-\d{3}z)/);
      const sizeRaw = parts[4]; // bytes

      files.push({
        filename,
        serverId,
        createdAt: dateMatch
          ? new Date(dateMatch[1].replace(/-(\d{2})-(\d{2})-(\d{3})z$/, ':$1:$2.$3Z').replace('t', 'T'))
          : new Date(),
        sizeMb: sizeRaw ? Math.round(parseInt(sizeRaw) / 1024 / 1024) : null,
      });
    }

    return files.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // mais recente primeiro
  }
}
