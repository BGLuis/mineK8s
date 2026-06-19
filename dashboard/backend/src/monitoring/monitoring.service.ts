import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';

export interface ServerMetrics {
  serverId: string;
  cpuCores: number; // Ex: 0.5 = 500m
  memoryMb: number; // Ex: 4096 = 4GB
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private k8sCustomApi: k8s.CustomObjectsApi;
  private readonly namespace = 'default';

  constructor() {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    this.k8sCustomApi = kc.makeApiClient(k8s.CustomObjectsApi);
  }

  /**
   * Retorna as métricas (CPU e Memória) de todos os servidores Minecraft online.
   */
  async getMetrics(): Promise<ServerMetrics[]> {
    try {
      const res = await this.k8sCustomApi.listNamespacedCustomObject({
        group: 'metrics.k8s.io',
        version: 'v1beta1',
        namespace: this.namespace,
        plural: 'pods',
      });

      const items = (res.body as any).items || [];
      const metrics: ServerMetrics[] = [];

      for (const item of items) {
        const podName = item.metadata.name;
        
        // Foca apenas nos pods de Minecraft que seguem o padrão mc-*
        if (!podName.startsWith('mc-')) continue;

        const labels = item.metadata.labels || {};
        // Recupera o ID do servidor (nome do Deployment) da label app
        const serverId = labels.app;
        if (!serverId) continue;

        let totalCpuNano = 0;
        let totalMemKi = 0;

        for (const container of item.containers || []) {
          // Parse CPU
          // O K8s retorna em nano cores (ex: "35357078n") ou mili cores (ex: "5m")
          const cpuRaw = container.usage.cpu;
          if (cpuRaw.endsWith('n')) {
            totalCpuNano += parseInt(cpuRaw.replace('n', ''), 10);
          } else if (cpuRaw.endsWith('m')) {
            totalCpuNano += parseInt(cpuRaw.replace('m', ''), 10) * 1_000_000;
          }

          // Parse Memory
          // O K8s retorna em Ki (Kibibytes, ex: "6061836Ki") ou Mi (Mebibytes, ex: "5Mi")
          const memRaw = container.usage.memory;
          if (memRaw.endsWith('Ki')) {
            totalMemKi += parseInt(memRaw.replace('Ki', ''), 10);
          } else if (memRaw.endsWith('Mi')) {
            totalMemKi += parseInt(memRaw.replace('Mi', ''), 10) * 1024;
          } else if (memRaw.endsWith('Gi')) {
            totalMemKi += parseInt(memRaw.replace('Gi', ''), 10) * 1024 * 1024;
          }
        }

        // Converte Nano Cores para Cores (1 Core = 1.000.000.000 Nano Cores)
        const cpuCores = parseFloat((totalCpuNano / 1_000_000_000).toFixed(3));
        
        // Converte Kibibytes para Megabytes (1 MB = 1024 KB aprox)
        const memoryMb = Math.round(totalMemKi / 1024);

        metrics.push({
          serverId,
          cpuCores,
          memoryMb,
        });
      }

      // Agrupa as métricas caso exista mais de um pod por servidor (embora seja replicas=1)
      const groupedMetrics = metrics.reduce((acc, curr) => {
        if (!acc[curr.serverId]) {
          acc[curr.serverId] = curr;
        } else {
          acc[curr.serverId].cpuCores += curr.cpuCores;
          acc[curr.serverId].memoryMb += curr.memoryMb;
        }
        return acc;
      }, {} as Record<string, ServerMetrics>);

      return Object.values(groupedMetrics);

    } catch (err: any) {
      this.logger.warn(`Falha ao obter métricas do K8s (Metrics Server pode não estar instalado): ${err.message}`);
      return [];
    }
  }

  /**
   * Retorna as métricas de um único servidor, ou objeto zerado se não estiver rodando.
   */
  async getServerMetrics(serverId: string): Promise<ServerMetrics> {
    const allMetrics = await this.getMetrics();
    const serverMetric = allMetrics.find(m => m.serverId === serverId);
    
    return serverMetric || {
      serverId,
      cpuCores: 0,
      memoryMb: 0
    };
  }
}
