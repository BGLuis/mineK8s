import type { Readable } from 'node:stream';

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

export interface K8sJobStatus {
  active?: number;
  succeeded?: number;
  failed?: number;
  podPhase?: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
}

export interface K8sJobInfo {
  name: string;
  namespace: string;
  status: K8sJobStatus;
}

export interface K8sPodStats {
  startedAt: Date | null;
  /** Working set of the pod's containers; null when the Metrics API is unavailable. */
  memoryUsedBytes: number | null;
  memoryLimitBytes: number | null;
}

export interface IKubernetesDriver {
  createPersistentVolumeClaim(manifest: any): Promise<void>;
  createDeployment(manifest: any): Promise<void>;
  replaceDeployment(manifest: any): Promise<void>;
  createService(manifest: any): Promise<void>;
  scaleDeployment(name: string, replicas: number, namespace?: string): Promise<void>;
  deleteDeployment(name: string, namespace?: string): Promise<void>;
  deleteService(name: string, namespace?: string): Promise<void>;
  deletePersistentVolumeClaim(name: string, namespace?: string): Promise<void>;
  getDeployment(name: string, namespace?: string): Promise<K8sDeploymentInfo | null>;
  listDeployments(namespace?: string): Promise<K8sDeploymentInfo[]>;
  /** Follows the game container's log in the running pod of a deployment; null when it has none. */
  streamPodLogs(deploymentName: string, namespace?: string): Promise<Readable | null>;
  /** Stats of the running pod of a deployment; null when it has none. */
  getPodStats(deploymentName: string, namespace?: string): Promise<K8sPodStats | null>;
  createJob(manifest: any): Promise<void>;
  getJob(name: string, namespace?: string): Promise<K8sJobInfo | null>;
  deleteJob(name: string, namespace?: string): Promise<void>;
  waitForJobPodRunning(name: string, timeoutMs?: number, namespace?: string): Promise<boolean>;
  waitForJobCompletion(name: string, timeoutMs?: number, namespace?: string): Promise<boolean>;
}

export const KUBERNETES_DRIVER = 'KUBERNETES_DRIVER';
