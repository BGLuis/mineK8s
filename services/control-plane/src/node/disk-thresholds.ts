export type DiskAlertLevel = 'warning' | 'danger';

export interface DiskStatus {
  alert: DiskAlertLevel | null;
  blocksCreation: boolean;
}

/** SRS 05 §1.1: aviso a 75 %, crítico a 90 % e bloqueio de novas instâncias a 85 % do disco do host. */
export const DISK_WARNING_PERCENT = 75;
export const DISK_CRITICAL_PERCENT = 90;
export const DISK_CREATION_BLOCK_PERCENT = 85;

export function classifyDiskUsage(usedPercent: number): DiskStatus {
  let alert: DiskAlertLevel | null = null;
  if (usedPercent >= DISK_CRITICAL_PERCENT) {
    alert = 'danger';
  } else if (usedPercent >= DISK_WARNING_PERCENT) {
    alert = 'warning';
  }
  return { alert, blocksCreation: usedPercent >= DISK_CREATION_BLOCK_PERCENT };
}
