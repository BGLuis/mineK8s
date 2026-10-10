import * as path from 'node:path';

export function serverDataVolumeName(resourceName: string): string {
  return `data-${resourceName}`;
}

/**
 * A server's directory relative to SERVERS_DATA_ROOT. The local-nvme StorageClass provisions each
 * PVC at <storage>/<namespace>/ + its pathPattern (k8s/storageclass.yaml), and the control plane
 * mounts <storage>/<namespace> as SERVERS_DATA_ROOT, so both see the same files.
 */
export function serverDataDirectory(resourceName: string): string {
  return path.join(serverDataVolumeName(resourceName), 'volume');
}
