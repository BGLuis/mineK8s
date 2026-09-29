import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { AppConfigService } from '@config/app-config.service';

import { IKubernetesDriver, K8sDeploymentInfo } from '../k8s.interface';

@Injectable()
export class RealKubernetesDriver implements IKubernetesDriver {
  private readonly logger = new Logger(RealKubernetesDriver.name);
  private readonly kc: k8s.KubeConfig;
  private readonly coreV1Api: k8s.CoreV1Api;
  private readonly appsV1Api: k8s.AppsV1Api;

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
    await this.appsV1Api.patchNamespacedDeploymentScale({
      name,
      namespace,
      body: {
        spec: { replicas },
      },
    });
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
}
