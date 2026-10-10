import { asHttpError } from '../../../core/api/api-error';
import { BackupMode, BackupStatus, BackupType, ServerBackup } from '../../../core/api/models';

export const BACKUP_TYPE_LABELS: Record<BackupType, string> = {
  HOT_SCHEDULED: 'Agendado · quente',
  COLD_MANUAL: 'Manual · frio',
  PRE_UPDATE: 'Pré-atualização',
  PRE_RESTORE: 'Pré-restauração',
};

export function backupTypeLabel(type: BackupType): string {
  return BACKUP_TYPE_LABELS[type] ?? type;
}

export type BackupTone = 'success' | 'warning' | 'danger' | 'info';

export const BACKUP_STATUS: Record<BackupStatus, { label: string; tone: BackupTone }> = {
  COMPLETED: { label: 'Concluído', tone: 'success' },
  FAILED: { label: 'Falhou', tone: 'danger' },
  IN_PROGRESS: { label: 'Em andamento', tone: 'info' },
  PENDING: { label: 'Pendente', tone: 'warning' },
};

export function shortHash(sha256: string): string {
  return sha256.length > 10 ? `${sha256.slice(0, 4)}…${sha256.slice(-4)}` : sha256;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `dd/MM HH:mm` in the browser's time zone, as in the history table. */
export function formatBackupDate(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `backup_<world>_<yyyy-MM-dd_HH-mm-ss>.tar.gz`, with the date in the browser's time zone. */
export function backupDownloadName(serverName: string, createdAt: string): string {
  const slug = serverName
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const date = new Date(createdAt);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `backup_${slug || 'mundo'}_${day}_${time}.tar.gz`;
}

export function formatBackupSize(bytes: number): string {
  if (!bytes || bytes <= 0) {
    return '—';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit >= 3 ? 2 : unit === 0 ? 0 : 1;
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[unit]}`;
}

export function storageSummary(backups: readonly ServerBackup[]): string {
  const total = backups.reduce((sum, backup) => sum + (backup.sizeBytes || 0), 0);
  const count = backups.length === 1 ? '1 backup' : `${backups.length} backups`;
  return `${count} · ${formatBackupSize(total)} usados`;
}

export function formatFreeze(ms: number | undefined): string {
  return ms === undefined || ms === null ? '—' : `${ms.toLocaleString('pt-BR')} ms`;
}

export function canRestore(backup: ServerBackup): boolean {
  return backup.status === 'COMPLETED';
}

export type BackupAction = 'create' | 'restore' | 'delete' | 'download' | 'list';

export function backupErrorMessage(
  action: BackupAction,
  error: unknown,
  mode: BackupMode = 'HOT',
): string {
  const http = asHttpError(error);
  if (!http) {
    return 'Algo deu errado. Tente novamente.';
  }
  switch (http.status) {
    case 0:
      return 'Não foi possível falar com o painel. Verifique sua conexão.';
    case 403:
      return action === 'delete'
        ? 'Backup protegido não pode ser excluído.'
        : 'Você não tem permissão para esta ação.';
    case 400:
      return action === 'delete'
        ? 'Backup de pré-restauração fica retido por 48 h e ainda não pode ser excluído.'
        : 'O pedido foi recusado pelo servidor.';
    case 404:
      return action === 'download'
        ? 'O arquivo deste backup não foi encontrado no armazenamento.'
        : 'Backup ou servidor não encontrado. Atualize a lista.';
    case 409:
      if (action === 'restore') {
        return 'Pare o servidor antes de restaurar. A restauração só roda com o servidor parado e sem outra tarefa de backup em andamento.';
      }
      return mode === 'COLD'
        ? 'O backup a frio exige o servidor parado e sem outra tarefa de backup em andamento.'
        : 'O backup a quente exige o servidor ONLINE e sem outra tarefa de backup em andamento.';
    case 507:
      return 'Espaço em disco insuficiente no armazenamento de backups.';
    default:
      return 'Algo deu errado no servidor. Tente novamente.';
  }
}

/** Only these refusals can be overridden with `force=true`. */
export function isForceableDeleteError(error: unknown): boolean {
  const http = asHttpError(error);
  return http !== null && (http.status === 403 || http.status === 400);
}

/** The simulated progress never reaches 100 % until the real request answers, so it cannot lie about completion. */
export const SIMULATED_PROGRESS_CEILING = 90;

export function backupDisplayPercent(simulatedPercent: number, finished: boolean): number {
  return finished ? 100 : Math.min(simulatedPercent, SIMULATED_PROGRESS_CEILING);
}

export const RETENTION_SUMMARY =
  'Rotina: últimos 5 backups agendados · Pré-atualização: 14 dias · Pré-restauração: 48 h';
