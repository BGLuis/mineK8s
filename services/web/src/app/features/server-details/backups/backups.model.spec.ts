import { HttpErrorResponse } from '@angular/common/http';

import { ServerBackup } from '../../../core/api/models';
import {
  backupDisplayPercent,
  backupErrorMessage,
  backupTypeLabel,
  canRestore,
  formatBackupSize,
  isForceableDeleteError,
  shortHash,
  storageSummary,
} from './backups.model';

const http = (status: number) => new HttpErrorResponse({ status });

describe('backupTypeLabel', () => {
  it('uses the labels of the design for each backend type', () => {
    expect(backupTypeLabel('HOT_SCHEDULED')).toBe('Agendado · quente');
    expect(backupTypeLabel('COLD_MANUAL')).toBe('Manual · frio');
    expect(backupTypeLabel('PRE_UPDATE')).toBe('Pré-atualização');
    expect(backupTypeLabel('PRE_RESTORE')).toBe('Pré-restauração');
  });
});

describe('backupErrorMessage', () => {
  it('403 on delete means the backup is protected', () => {
    expect(backupErrorMessage('delete', http(403))).toContain('protegido');
  });

  it('400 on delete means the 48 h pre-restore retention is still running', () => {
    expect(backupErrorMessage('delete', http(400))).toContain('48 h');
  });

  it('409 on restore tells the user to stop the server', () => {
    expect(backupErrorMessage('restore', http(409))).toContain('Pare o servidor');
  });

  it('409 on create depends on the backup mode', () => {
    expect(backupErrorMessage('create', http(409), 'HOT')).toContain('ONLINE');
    expect(backupErrorMessage('create', http(409), 'COLD')).toContain('parado');
  });

  it('507 reports missing disk space', () => {
    expect(backupErrorMessage('create', http(507))).toContain('Espaço em disco');
  });
});

describe('isForceableDeleteError', () => {
  it('is true only for the protected (403) and pre-restore retention (400) refusals', () => {
    expect(isForceableDeleteError(http(403))).toBe(true);
    expect(isForceableDeleteError(http(400))).toBe(true);
    expect(isForceableDeleteError(http(404))).toBe(false);
    expect(isForceableDeleteError(http(500))).toBe(false);
  });
});

describe('formatting', () => {
  it('shortens the SHA-256 to head and tail', () => {
    expect(shortHash('3fa9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa7c21')).toBe('3fa9…7c21');
    expect(shortHash('')).toBe('');
  });

  it('formats sizes with pt-BR decimals and a dash when empty', () => {
    expect(formatBackupSize(1.24 * 1024 ** 3)).toBe('1,24 GB');
    expect(formatBackupSize(512 * 1024)).toBe('512,0 KB');
    expect(formatBackupSize(0)).toBe('—');
  });

  it('sums the storage used by the history', () => {
    const backup = (sizeBytes: number) => ({ sizeBytes }) as ServerBackup;
    expect(storageSummary([backup(1024 ** 3), backup(1024 ** 3)])).toBe('2 backups · 2,00 GB usados');
  });
});

describe('canRestore', () => {
  it('allows restoring only completed backups', () => {
    expect(canRestore({ status: 'COMPLETED' } as ServerBackup)).toBe(true);
    expect(canRestore({ status: 'FAILED' } as ServerBackup)).toBe(false);
    expect(canRestore({ status: 'IN_PROGRESS' } as ServerBackup)).toBe(false);
  });
});

describe('backupDisplayPercent', () => {
  it('holds the simulated progress below 100 % until the backup request finishes', () => {
    expect(backupDisplayPercent(50, false)).toBe(50);
    expect(backupDisplayPercent(100, false)).toBe(90);
    expect(backupDisplayPercent(100, true)).toBe(100);
    expect(backupDisplayPercent(10, true)).toBe(100);
  });
});
