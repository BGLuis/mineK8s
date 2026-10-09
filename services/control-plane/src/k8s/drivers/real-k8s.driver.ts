import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { AppConfigService } from '@config/app-config.service';

import { IKubernetesDriver, K8sDeploymentInfo, K8sJobInfo, K8sPodStats } from '../k8s.interface';
import { memoryQuantityToBytes } from '../memory-quantity';

@Injectable()
export class RealKubernetesDriver implements IKubernetesDriver {
  private readonly logger = new Logger(RealKubernetesDriver.name);
  private readonly kc: k8s.KubeConfig;
  private readonly coreV1Api: k8s.CoreV1Api;
  private readonly appsV1Api: k8s.AppsV1Api;
  private readonly batchV1Api: k8s.BatchV1Api;
  private readonly metricsApi: k8s.Metrics;

  constructor(private readonly configService: AppConfigService) {
    this.kc = new k8s.KubeConfig();

    if (this.configService.kubernetes.inCluster) {
      this.kc.loadFromCluster();
      this.logger.log('Loaded in-cluster Kubernetes configuration.');
    } else {
      const customPath = this.configService.kubernetes.kubeconfig;
      const defaultPath = path.join(os.homedir(), '.kube', 'config');
      const kubeconfigPath = customPath || defaultPath;

      if (fs.existsSync(kubeconfigPath)) {
        this.kc.loadFromFile(kubeconfigPath);
        this.logger.log(`Loaded Kubernetes configuration from: ${kubeconfigPath}`);
      } else {
        this.kc.loadFromDefault();
        this.logger.warn(`Kubeconfig not found at ${kubeconfigPath}; falling back to default.`);
      }
    }

    this.coreV1Api = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsV1Api = this.kc.makeApiClient(k8s.AppsV1Api);
    this.batchV1Api = this.kc.makeApiClient(k8s.BatchV1Api);
    this.metricsApi = new k8s.Metrics(this.kc);
  }

  async createPersistentVolumeClaim(manifest: any): Promise<void> {
    const ns = manifest.metadata.namespace || this.configService.kubernetes.namespace;
    await this.coreV1Api.createNamespacedPersistentVolumeClaim({
      namespace: ns,
      body: manifest,
    });
  }

  async createDeployment(manifest: any): Promise<void> {
    const ns = manifest.metadata.namespace || this.configService.kubernetes.namespace;
    await this.appsV1Api.createNamespacedDeployment({
      namespace: ns,
      body: manifest,
    });
  }

  async replaceDeployment(manifest: any): Promise<void> {
    const ns = manifest.metadata.namespace || this.configService.kubernetes.namespace;
    await this.appsV1Api.replaceNamespacedDeployment({
      name: manifest.metadata.name,
      namespace: ns,
      body: manifest,
    });
  }

  async createService(manifest: any): Promise<void> {
    const ns = manifest.metadata.namespace || this.configService.kubernetes.namespace;
    await this.coreV1Api.createNamespacedService({
      namespace: ns,
      body: manifest,
    });
  }

  async scaleDeployment(
    name: string,
    replicas: number,
    namespace = this.configService.kubernetes.namespace,
  ): Promise<void> {
    // The client defaults PATCH to JSON Patch, which expects a list of operations, not this object.
    await this.appsV1Api.patchNamespacedDeploymentScale(
      { name, namespace, body: { spec: { replicas } } },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch),
    );
  }

  async deleteDeployment(
    name: string,
    namespace = this.configService.kubernetes.namespace,
  ): Promise<void> {
    try {
      await this.appsV1Api.deleteNamespacedDeployment({
        name,
        namespace,
      });
    } catch (err: any) {
      if (err?.statusCode !== 404) throw err;
    }
  }

  async deleteService(
    name: string,
    namespace = this.configService.kubernetes.namespace,
  ): Promise<void> {
    try {
      await this.coreV1Api.deleteNamespacedService({
        name,
        namespace,
      });
    } catch (err: any) {
      if (err?.statusCode !== 404) throw err;
    }
  }

  async deletePersistentVolumeClaim(
    name: string,
    namespace = this.configService.kubernetes.namespace,
  ): Promise<void> {
    try {
      await this.coreV1Api.deleteNamespacedPersistentVolumeClaim({
        name,
        namespace,
      });
    } catch (err: any) {
      if (err?.statusCode !== 404) throw err;
    }
  }

  async getDeployment(
    name: string,
    namespace = this.configService.kubernetes.namespace,
  ): Promise<K8sDeploymentInfo | null> {
    try {
      const res = await this.appsV1Api.readNamespacedDeployment({
        name,
        namespace,
      });
      return {
        name,
        namespace,
        replicas: res.spec?.replicas ?? 0,
        status: {
          replicas: res.status?.replicas,
          readyReplicas: res.status?.readyReplicas,
          availableReplicas: res.status?.availableReplicas,
          unavailableReplicas: res.status?.unavailableReplicas,
        },
      };
    } catch (err: any) {
      if (err?.statusCode === 404) return null;
      throw err;
    }
  }

  async listDeployments(
    namespace = this.configService.kubernetes.namespace,
  ): Promise<K8sDeploymentInfo[]> {
    const res = await this.appsV1Api.listNamespacedDeployment({ namespace });
    return (res.items || []).map((item) => ({
      name: item.metadata?.name || '',
      namespace,
      replicas: item.spec?.replicas ?? 0,
      status: {
        replicas: item.status?.replicas,
        readyReplicas: item.status?.readyReplicas,
        availableReplicas: item.status?.availableReplicas,
        unavailableReplicas: item.status?.unavailableReplicas,
      },
    }));
  }

  async getPodStats(
    deploymentName: string,
    namespace = this.configService.kubernetes.namespace,
  ): Promise<K8sPodStats | null> {
    const pods = await this.coreV1Api.listNamespacedPod({
      namespace,
      labelSelector: `app.kubernetes.io/name=${deploymentName}`,
    });
    const pod = pods.items.find((p) => p.status?.phase === 'Running' && p.metadata?.name);
    if (!pod?.metadata?.name) {
      return null;
    }

    const limits = (pod.spec?.containers ?? []).map((c) => c.resources?.limits?.memory);
    const memoryLimitBytes = limits.every((l) => l)
      ? limits.reduce((sum, l) => sum + memoryQuantityToBytes(l as string), 0)
      : null;

    let memoryUsedBytes: number | null = null;
    try {
      const metrics = await this.metricsApi.getPodMetrics(namespace);
      const podMetric = metrics.items.find((m) => m.metadata.name === pod.metadata?.name);
      if (podMetric) {
        memoryUsedBytes = podMetric.containers.reduce(
          (sum, c) => sum + memoryQuantityToBytes(c.usage.memory),
          0,
        );
      }
    } catch (err: any) {
      this.logger.debug(`Metrics API unavailable for ${deploymentName}: ${err?.message}`);
    }

    return {
      startedAt: pod.status?.startTime ? new Date(pod.status.startTime) : null,
      memoryUsedBytes,
      memoryLimitBytes,
    };
  }

  async createJob(manifest: any): Promise<void> {
    const ns = manifest.metadata.namespace || this.configService.kubernetes.namespace;
    await this.batchV1Api.createNamespacedJob({
      namespace: ns,
      body: manifest,
    });
  }

  async getJob(
    name: string,
    namespace = this.configService.kubernetes.namespace,
  ): Promise<K8sJobInfo | null> {
    try {
      const res = await this.batchV1Api.readNamespacedJob({
        name,
        namespace,
      });
      return {
        name,
        namespace,
        status: {
          active: res.status?.active,
          succeeded: res.status?.succeeded,
          failed: res.status?.failed,
        },
      };
    } catch (err: any) {
      if (err?.statusCode === 404) return null;
      throw err;
    }
  }

  async deleteJob(
    name: string,
    namespace = this.configService.kubernetes.namespace,
  ): Promise<void> {
    try {
      await this.batchV1Api.deleteNamespacedJob({
        name,
        namespace,
        propagationPolicy: 'Foreground',
      });
    } catch (err: any) {
      if (err?.statusCode !== 404) throw err;
    }
  }

  async waitForJobPodRunning(
    jobName: string,
    timeoutMs = 60000,
    namespace = this.configService.kubernetes.namespace,
  ): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const pods = await this.coreV1Api.listNamespacedPod({
          namespace,
          labelSelector: `job-name=${jobName}`,
        });
        const pod = pods.items?.[0];
        if (pod) {
          const phase = pod.status?.phase;
          if (phase === 'Running' || phase === 'Succeeded') {
            return true;
          }
          if (phase === 'Failed') {
            return false;
          }
        }
      } catch (err) {
        this.logger.debug(
          `Error checking pod status for job ${jobName}: ${(err as Error).message}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return false;
  }

  async waitForJobCompletion(
    jobName: string,
    timeoutMs = 120000,
    namespace = this.configService.kubernetes.namespace,
  ): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const job = await this.getJob(jobName, namespace);
      if (job) {
        if ((job.status.succeeded ?? 0) > 0) {
          return true;
        }
        if ((job.status.failed ?? 0) > 0) {
          return false;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }
}
