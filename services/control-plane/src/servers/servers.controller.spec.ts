import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { ServersFilesService } from './servers-files.service';
import { ServersBackupService } from './servers-backup.service';

describe('ServersController - Backup Endpoints (RF-STO-17)', () => {
  let controller: ServersController;
  let mockServersService: any;
  let mockFilesService: any;
  let mockBackupService: any;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ctrl-backup-test-'));

    mockServersService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      updateVersion: jest.fn(),
      delete: jest.fn(),
      updateDomain: jest.fn(),
      getLogs: jest.fn(),
      sendCommand: jest.fn(),
    };

    mockFilesService = {
      listFiles: jest.fn(),
      readFile: jest.fn(),
      writeFile: jest.fn(),
      deleteFile: jest.fn(),
      uploadWorld: jest.fn(),
    };

    mockBackupService = {
      createBackupForServer: jest.fn().mockResolvedValue({
        taskId: 'task-123',
        backupId: 'backup-123',
        result: {
          backupId: 'backup-123',
          serverId: 'srv-1',
          filename: 'test.tar.gz',
          storagePath: '/backups/test.tar.gz',
          backupType: 'HOT',
          sizeBytes: 1024,
          sha256Checksum: 'abcdef',
        },
      }),
      listBackups: jest.fn().mockResolvedValue([
        {
          id: 'backup-123',
          serverId: 'srv-1',
          filename: 'test.tar.gz',
          sizeBytes: 1024,
          sha256Checksum: 'abcdef',
          backupType: 'HOT_SCHEDULED',
          status: 'COMPLETED',
          isProtected: false,
          createdAt: new Date(),
        },
      ]),
      deleteBackup: jest.fn().mockResolvedValue({
        message: 'Backup removido com sucesso',
        backupId: 'backup-123',
      }),
      restoreBackupById: jest.fn().mockResolvedValue({
        taskId: 'restore-task-456',
        message: 'Restauração transacional concluída com sucesso',
      }),
      getBackup: jest.fn(),
    };

    controller = new ServersController(
      mockServersService as ServersService,
      mockFilesService as ServersFilesService,
      mockBackupService as ServersBackupService,
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('POST :id/backups deve disparar criação de backup e retornar 202 Accepted (RF-STO-17)', async () => {
    const result = await controller.createBackup('srv-1', { type: 'HOT' });

    expect(mockBackupService.createBackupForServer).toHaveBeenCalledWith('srv-1', 'HOT');
    expect(result).toEqual({
      taskId: 'task-123',
      backupId: 'backup-123',
      result: expect.objectContaining({ backupId: 'backup-123' }),
    });
  });

  it('GET :id/backups deve listar backups ordenados decrescente (RF-STO-17)', async () => {
    const result = await controller.listBackups('srv-1');

    expect(mockBackupService.listBackups).toHaveBeenCalledWith('srv-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('backup-123');
  });

  it('DELETE :id/backups/:backupId deve repassar flag force e remover backup (RF-STO-17)', async () => {
    const result = await controller.deleteBackup('srv-1', 'backup-123', 'true');

    expect(mockBackupService.deleteBackup).toHaveBeenCalledWith('srv-1', 'backup-123', true);
    expect(result.message).toContain('removido com sucesso');
  });

  it('POST :id/backups/:backupId/restore deve disparar restauração transacional (RF-STO-17)', async () => {
    const result = await controller.restoreBackup('srv-1', 'backup-123');

    expect(mockBackupService.restoreBackupById).toHaveBeenCalledWith('srv-1', 'backup-123');
    expect(result.taskId).toBe('restore-task-456');
    expect(result.message).toContain('Restauração transacional');
  });

  it('GET :id/backups/:backupId/download deve realizar streaming binário com headers corretos (RF-STO-17)', async () => {
    const filePath = path.join(tempDir, 'download-test.tar.gz');
    await fs.promises.writeFile(filePath, 'tar-binary-content');

    mockBackupService.getBackup.mockResolvedValue({
      id: 'backup-dl-1',
      serverId: 'srv-1',
      filename: 'download-test.tar.gz',
      storagePath: filePath,
      sizeBytes: 18,
    });

    const headers: Record<string, any> = {};
    const res: any = {
      setHeader: jest.fn((k, v) => {
        headers[k] = v;
      }),
      on: jest.fn(),
      once: jest.fn(),
      emit: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };

    await controller.downloadBackup('srv-1', 'backup-dl-1', res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/gzip');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="download-test.tar.gz"',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 18);
  });

  it('GET :id/backups/:backupId/download deve lançar NotFoundException se o arquivo físico não existir', async () => {
    mockBackupService.getBackup.mockResolvedValue({
      id: 'backup-missing',
      serverId: 'srv-1',
      filename: 'missing.tar.gz',
      storagePath: '/non/existent/path/missing.tar.gz',
      sizeBytes: 100,
    });

    const res: any = {
      setHeader: jest.fn(),
    };

    await expect(controller.downloadBackup('srv-1', 'backup-missing', res)).rejects.toThrow(
      NotFoundException,
    );
  });
});
