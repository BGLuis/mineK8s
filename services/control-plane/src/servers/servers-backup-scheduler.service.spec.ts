import { Repository } from 'typeorm';

import { AppConfigService } from '@config/app-config.service';
import { BackupStatus, ServerBackupEntity } from '@database/entities/server-backup.entity';
import { Server } from '@database/entities/server.entity';
import {
  ServersBackupSchedulerService,
  adjustToWindow,
  calculateNextRun,
  getLocalParts,
  isInsideWindow,
  timeToMinutes,
  zonedTimeToUtc,
} from './servers-backup-scheduler.service';
import { ServersBackupService } from './servers-backup.service';

describe('ServersBackupSchedulerService (#205)', () => {
  let scheduler: ServersBackupSchedulerService;
  let serverRepo: jest.Mocked<Repository<Server>>;
  let backupRepo: jest.Mocked<Repository<ServerBackupEntity>>;
  let backupService: jest.Mocked<ServersBackupService>;
  let configService: jest.Mocked<AppConfigService>;

  beforeEach(() => {
    serverRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    } as any;

    backupRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
    } as any;

    backupService = {
      createBackup: jest.fn().mockResolvedValue({} as any),
    } as any;

    configService = {
      isTest: true,
    } as any;

    scheduler = new ServersBackupSchedulerService(
      serverRepo,
      backupRepo,
      backupService,
      configService,
    );
  });

  describe('calculateNextRun e conversões de timezone', () => {
    it('DAILY às 04:00 em America/Sao_Paulo dispara às 07:00 UTC', () => {
      // 2026-10-18 20:00 UTC = 17:00 em São Paulo (UTC-3)
      const fromDate = new Date('2026-10-18T20:00:00.000Z');
      const nextRun = calculateNextRun(
        {
          backup_schedule_mode: 'DAILY',
          backup_daily_time: '04:00',
          backup_timezone: 'America/Sao_Paulo',
        },
        fromDate,
      );

      expect(nextRun).not.toBeNull();
      // 04:00 em São Paulo em 19 de outubro de 2026 corresponde exatamente a 07:00 UTC
      expect(nextRun?.toISOString()).toBe('2026-10-19T07:00:00.000Z');
    });

    it('DAILY já passado hoje agenda para amanhã no mesmo horário', () => {
      // 2026-10-19 07:00 UTC = 04:00 em São Paulo
      const fromDate = new Date('2026-10-19T07:00:00.000Z');
      const nextRun = calculateNextRun(
        {
          backup_schedule_mode: 'DAILY',
          backup_daily_time: '04:00',
          backup_timezone: 'America/Sao_Paulo',
        },
        fromDate,
      );

      expect(nextRun?.toISOString()).toBe('2026-10-20T07:00:00.000Z');
    });

    it('com janela 02:00–06:00, um vencimento às 07:00 espera até as 02:00 do dia seguinte', () => {
      // 07:00 em São Paulo = 10:00 UTC
      const dueAt0700Sp = zonedTimeToUtc(2026, 10, 19, 7, 0, 'America/Sao_Paulo');
      const adjusted = adjustToWindow(dueAt0700Sp, '02:00', '06:00', 'America/Sao_Paulo');

      const localParts = getLocalParts(adjusted, 'America/Sao_Paulo');
      expect(localParts.day).toBe(20);
      expect(localParts.hour).toBe(2);
      expect(localParts.minute).toBe(0);
      // 02:00 em São Paulo no dia 20 = 05:00 UTC
      expect(adjusted.toISOString()).toBe('2026-10-20T05:00:00.000Z');
    });

    it('com janela 02:00–06:00, um horário às 04:00 é mantido', () => {
      const dueAt0400Sp = zonedTimeToUtc(2026, 10, 19, 4, 0, 'America/Sao_Paulo');
      const adjusted = adjustToWindow(dueAt0400Sp, '02:00', '06:00', 'America/Sao_Paulo');

      expect(adjusted.toISOString()).toBe(dueAt0400Sp.toISOString());
    });

    it('retorna null se modo for OFF ou indefinido', () => {
      expect(calculateNextRun({ backup_schedule_mode: 'OFF' })).toBeNull();
      expect(calculateNextRun({})).toBeNull();
    });
  });

  describe('runScheduledTick', () => {
    it('modo INTERVAL de 12 h gera dois backups em 24 h com relógio simulado', async () => {
      const t0 = new Date('2026-10-19T00:00:00.000Z');
      const server = {
        id: 'srv-1',
        subdomain: 'survival',
        state: 'READY' as const,
        backup_schedule_mode: 'INTERVAL' as const,
        backup_interval_hours: 12,
        backup_timezone: 'America/Sao_Paulo',
        backup_next_run_at: new Date('2026-10-19T00:00:00.000Z'),
      } as Server;

      // Tick 1: T0 (00:00 UTC) -> deve disparar o 1º backup
      serverRepo.find.mockResolvedValueOnce([server]);
      await scheduler.runScheduledTick(t0);

      expect(backupService.createBackup).toHaveBeenCalledTimes(1);
      expect(backupService.createBackup).toHaveBeenLastCalledWith(server, 'HOT');
      expect(server.backup_next_run_at?.toISOString()).toBe('2026-10-19T12:00:00.000Z');

      // Tick intermediário: T0 + 6h -> não há servidores vencidos
      const t6 = new Date('2026-10-19T06:00:00.000Z');
      serverRepo.find.mockResolvedValueOnce([]);
      await scheduler.runScheduledTick(t6);
      expect(backupService.createBackup).toHaveBeenCalledTimes(1);

      // Tick 2: T0 + 12h (12:00 UTC) -> deve disparar o 2º backup
      const t12 = new Date('2026-10-19T12:00:00.000Z');
      serverRepo.find.mockResolvedValueOnce([server]);
      await scheduler.runScheduledTick(t12);

      expect(backupService.createBackup).toHaveBeenCalledTimes(2);
      expect(backupService.createBackup).toHaveBeenLastCalledWith(server, 'HOT');
      expect(server.backup_next_run_at?.toISOString()).toBe('2026-10-20T00:00:00.000Z');

      // Fim das 24h: total de 2 backups gerados
      expect(backupService.createBackup).toHaveBeenCalledTimes(2);
    });

    it('servidor STOPPED sem jogador desde o último backup não gera backup novo', async () => {
      const now = new Date('2026-10-19T10:00:00.000Z');
      const lastBackupDate = new Date('2026-10-19T08:00:00.000Z');
      const playerActiveDate = new Date('2026-10-19T07:30:00.000Z'); // anterior ao último backup

      const server = {
        id: 'srv-stopped',
        subdomain: 'creative',
        state: 'STOPPED' as const,
        backup_schedule_mode: 'INTERVAL' as const,
        backup_interval_hours: 6,
        last_player_active_at: playerActiveDate,
        backup_next_run_at: now,
      } as Server;

      serverRepo.find.mockResolvedValueOnce([server]);
      backupRepo.findOne.mockResolvedValueOnce({
        id: 'b-1',
        createdAt: lastBackupDate,
        status: BackupStatus.COMPLETED,
      } as ServerBackupEntity);

      await scheduler.runScheduledTick(now);

      // Não deve gerar backup
      expect(backupService.createBackup).not.toHaveBeenCalled();
      // Mas deve reagendar para o próximo horário
      expect(server.backup_next_run_at).not.toBeNull();
      expect(server.backup_next_run_at!.getTime()).toBeGreaterThan(now.getTime());
      expect(serverRepo.save).toHaveBeenCalledWith(server);
    });

    it('servidor STOPPED com jogador ativo após o último backup realiza backup COLD', async () => {
      const now = new Date('2026-10-19T10:00:00.000Z');
      const lastBackupDate = new Date('2026-10-19T08:00:00.000Z');
      const playerActiveDate = new Date('2026-10-19T09:00:00.000Z'); // posterior ao último backup

      const server = {
        id: 'srv-stopped-active',
        subdomain: 'creative',
        state: 'STOPPED' as const,
        backup_schedule_mode: 'INTERVAL' as const,
        backup_interval_hours: 6,
        last_player_active_at: playerActiveDate,
        backup_next_run_at: now,
      } as Server;

      serverRepo.find.mockResolvedValueOnce([server]);
      backupRepo.findOne.mockResolvedValueOnce({
        id: 'b-1',
        createdAt: lastBackupDate,
        status: BackupStatus.COMPLETED,
      } as ServerBackupEntity);

      await scheduler.runScheduledTick(now);

      expect(backupService.createBackup).toHaveBeenCalledWith(server, 'COLD');
      expect(server.backup_next_run_at!.getTime()).toBeGreaterThan(now.getTime());
    });

    it('servidor em outros estados (STARTING, UPDATING) não gera backup nem perde a vez', async () => {
      const now = new Date('2026-10-19T10:00:00.000Z');
      const server = {
        id: 'srv-starting',
        subdomain: 'survival',
        state: 'STARTING' as const,
        backup_schedule_mode: 'INTERVAL' as const,
        backup_interval_hours: 6,
        backup_next_run_at: now,
      } as Server;

      serverRepo.find.mockResolvedValueOnce([server]);

      await scheduler.runScheduledTick(now);

      expect(backupService.createBackup).not.toHaveBeenCalled();
      // Não altera backup_next_run_at para tentar de novo no próximo tick
      expect(server.backup_next_run_at).toBe(now);
      expect(serverRepo.save).not.toHaveBeenCalled();
    });

    it('quando vencido mas fora da janela, adia para a próxima abertura de janela', async () => {
      // 07:00 em São Paulo = 10:00 UTC
      const nowAt0700Sp = zonedTimeToUtc(2026, 10, 19, 7, 0, 'America/Sao_Paulo');
      const server = {
        id: 'srv-window',
        subdomain: 'survival',
        state: 'READY' as const,
        backup_schedule_mode: 'INTERVAL' as const,
        backup_interval_hours: 6,
        backup_window_start: '02:00',
        backup_window_end: '06:00',
        backup_timezone: 'America/Sao_Paulo',
        backup_next_run_at: nowAt0700Sp,
      } as Server;

      serverRepo.find.mockResolvedValueOnce([server]);

      await scheduler.runScheduledTick(nowAt0700Sp);

      // Não dispara backup fora da janela
      expect(backupService.createBackup).not.toHaveBeenCalled();
      // Adia para 02:00 de amanhã
      const localParts = getLocalParts(server.backup_next_run_at!, 'America/Sao_Paulo');
      expect(localParts.day).toBe(20);
      expect(localParts.hour).toBe(2);
      expect(localParts.minute).toBe(0);
      expect(serverRepo.save).toHaveBeenCalledWith(server);
    });
  });
});
