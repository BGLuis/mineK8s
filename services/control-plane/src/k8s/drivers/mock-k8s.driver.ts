import { Injectable, Logger } from '@nestjs/common';
import { IKubernetesDriver, K8sDeploymentInfo } from '../k8s.interface';

@Injectable()
export class MockKubernetesDriver implements IKubernetesDriver {
  private readonly logger = new Logger(MockKubernetesDriver.name);
  public readonly pvcs = new Map<string, any>();
  public readonly deployments = new Map<string, any>();
  public readonly services = new Map<string, any>();

  public reset() {
    this.pvcs.clear();
    this.deployments.clear();
    this.services.clear();
  }

  async createPersistentVolumeClaim(manifest: any): Promise<void> {
    const key = `${manifest.metadata.namespace || 'default'}/${manifest.metadata.name}`;
    this.pvcs.set(key, manifest);
    this.logger.debug(`[MockK8s] Created PVC: ${key}`);
  }

  async createDeployment(manifest: any): Promise<void> {
    const key = `${manifest.metadata.namespace || 'default'}/${manifest.metadata.name}`;
    this.deployments.set(key, manifest);
    this.logger.debug(`[MockK8s] Created Deployment: ${key}`);
  }

  async createService(manifest: any): Promise<void> {
    const key = `${manifest.metadata.namespace || 'default'}/${manifest.metadata.name}`;
    this.services.set(key, manifest);
    this.logger.debug(`[MockK8s] Created Service: ${key}`);
  }

  async scaleDeployment(
    name: string,
    replicas: number,
    namespace = 'minekubernetes',
  ): Promise<void> {
    const key = `${namespace}/${name}`;
    const deployment = this.deployments.get(key);
    if (deployment) {
      deployment.spec.replicas = replicas;
      this.deployments.set(key, deployment);
      this.logger.debug(`[MockK8s] Scaled Deployment ${key} to ${replicas}`);
    }
  }

  async deleteDeployment(name: string, namespace = 'minekubernetes'): Promise<void> {
    const key = `${namespace}/${name}`;
    this.deployments.delete(key);
    this.logger.debug(`[MockK8s] Deleted Deployment: ${key}`);
  }

  async deleteService(name: string, namespace = 'minekubernetes'): Promise<void> {
    const key = `${namespace}/${name}`;
    this.services.delete(key);
    this.logger.debug(`[MockK8s] Deleted Service: ${key}`);
  }

  async deletePersistentVolumeClaim(
    name: string,
    namespace = 'minekubernetes',
  ): Promise<void> {
    const key = `${namespace}/${name}`;
    this.pvcs.delete(key);
    this.logger.debug(`[MockK8s] Deleted PVC: ${key}`);
  }

  async getDeployment(
    name: string,
    namespace = 'minekubernetes',
  ): Promise<K8sDeploymentInfo | null> {
    const key = `${namespace}/${name}`;
    const deployment = this.deployments.get(key);
    if (!deployment) return null;

    const replicas = deployment.spec?.replicas ?? 0;
    return {
      name,
      namespace,
      replicas,
      status: {
        replicas,
        readyReplicas: replicas,
        availableReplicas: replicas,
      },
    };
  }

  async listDeployments(namespace = 'minekubernetes'): Promise<K8sDeploymentInfo[]> {
    const list: K8sDeploymentInfo[] = [];
    for (const [key, dep] of this.deployments.entries()) {
      if (key.startsWith(`${namespace}/`)) {
        const name = dep.metadata.name;
        const replicas = dep.spec?.replicas ?? 0;
        list.push({
          name,
          namespace,
          replicas,
          status: {
            replicas,
            readyReplicas: replicas,
            availableReplicas: replicas,
          },
        });
      }
    }
    return list;
  }
}
