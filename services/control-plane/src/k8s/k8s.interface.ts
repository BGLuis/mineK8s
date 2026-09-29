export interface K8sMetadata {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface K8sDeploymentStatus {
  replicas?: number;
  readyReplicas?: number;
  availableReplicas?: number;
  unavailableReplicas?: number;
}

export interface K8sDeploymentInfo {
  name: string;
  namespace: string;
  replicas: number;
  status: K8sDeploymentStatus;
}

export interface IKubernetesDriver {
  createPersistentVolumeClaim(manifest: any): Promise<void>;
  createDeployment(manifest: any): Promise<void>;
  createService(manifest: any): Promise<void>;
  scaleDeployment(name: string, replicas: number, namespace?: string): Promise<void>;
  deleteDeployment(name: string, namespace?: string): Promise<void>;
  deleteService(name: string, namespace?: string): Promise<void>;
  deletePersistentVolumeClaim(name: string, namespace?: string): Promise<void>;
  getDeployment(name: string, namespace?: string): Promise<K8sDeploymentInfo | null>;
  listDeployments(namespace?: string): Promise<K8sDeploymentInfo[]>;
}

export const KUBERNETES_DRIVER = 'KUBERNETES_DRIVER';
