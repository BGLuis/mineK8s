import { ConflictException } from '@nestjs/common';
import {
  calculateMilestones,
  ServerShutdownWarningService,
} from './server-shutdown-warning.service';
import { formatCountdownCancelledMessage, formatCountdownMessage } from './server-language';
import { Server } from '@database/entities/server.entity';

describe('ServerShutdownWarningService (#204)', () => {
  describe('calculateMilestones', () => {
    it('calcula marcos para 10 minutos (600s)', () => {
      expect(calculateMilestones(600)).toEqual([600, 300, 60, 30, 10]);
    });

    it('calcula marcos para 5 minutos (300s)', () => {
      expect(calculateMilestones(300)).toEqual([300, 60, 30, 10]);
    });

    it('calcula marcos para 3 minutos (180s)', () => {
      expect(calculateMilestones(180)).toEqual([180, 60, 30, 10]);
    });

    it('calcula marcos para 1 minuto (60s)', () => {
      expect(calculateMilestones(60)).toEqual([60, 30, 10]);
    });

    it('calcula marcos para 30 segundos', () => {
      expect(calculateMilestones(30)).toEqual([30, 10]);
    });

    it('calcula marcos para 10 segundos', () => {
      expect(calculateMilestones(10)).toEqual([10]);
    });

    it('retorna vazio para 0 ou negativo', () => {
      expect(calculateMilestones(0)).toEqual([]);
      expect(calculateMilestones(-5)).toEqual([]);
    });
  });

  describe('formatCountdownMessage', () => {
    it('formata mensagens em pt-BR', () => {
      expect(formatCountdownMessage('stop', 600, 'pt-BR')).toBe(
        'O servidor será desligado em 10 minutos.',
      );
      expect(formatCountdownMessage('stop', 60, 'pt-BR')).toBe(
        'O servidor será desligado em 1 minuto.',
      );
      expect(formatCountdownMessage('stop', 30, 'pt-BR')).toBe(
        'O servidor será desligado em 30 segundos.',
      );
      expect(formatCountdownMessage('restart', 300, 'pt-BR')).toBe(
        'O servidor será reiniciado em 5 minutos.',
      );
      expect(formatCountdownMessage('update-version', 300, 'pt-BR')).toBe(
        'O servidor será desligado para atualização em 5 minutos.',
      );
    });

    it('formata mensagens em en', () => {
      expect(formatCountdownMessage('stop', 600, 'en')).toBe(
        'The server will shut down in 10 minutes.',
      );
      expect(formatCountdownMessage('stop', 60, 'en')).toBe(
        'The server will shut down in 1 minute.',
      );
      expect(formatCountdownMessage('stop', 10, 'en')).toBe(
        'The server will shut down in 10 seconds.',
      );
      expect(formatCountdownMessage('restart', 300, 'en')).toBe(
        'The server will restart in 5 minutes.',
      );
      expect(formatCountdownMessage('update-version', 300, 'en')).toBe(
        'The server will shut down for update in 5 minutes.',
      );
    });
  });

  describe('formatCountdownCancelledMessage', () => {
    it('formata mensagens de cancelamento em pt-BR e en', () => {
      expect(formatCountdownCancelledMessage('stop', 'pt-BR')).toBe(
        'A parada do servidor foi cancelada.',
      );
      expect(formatCountdownCancelledMessage('restart', 'pt-BR')).toBe(
        'O reinício do servidor foi cancelado.',
      );
      expect(formatCountdownCancelledMessage('update-version', 'pt-BR')).toBe(
        'A atualização do servidor foi cancelada.',
      );

      expect(formatCountdownCancelledMessage('stop', 'en')).toBe(
        'The server shutdown has been cancelled.',
      );
      expect(formatCountdownCancelledMessage('restart', 'en')).toBe(
        'The server restart has been cancelled.',
      );
      expect(formatCountdownCancelledMessage('update-version', 'en')).toBe(
        'The server update has been cancelled.',
      );
    });
  });

  describe('scheduleCountdown lifecycle', () => {
    let service: ServerShutdownWarningService;
    let mockConsoleDriver: any;
    let mockTaskExecutionService: any;
    let mockSettingsRepo: any;
    let server: Server;

    let mockActivityBus: any;
    let mockPlayerSessions: any;

    beforeEach(() => {
      jest.useFakeTimers();

      mockConsoleDriver = {
        listPlayers: jest.fn().mockResolvedValue(['Steve', 'Alex']),
        sendCommand: jest.fn().mockResolvedValue(''),
      };

      mockTaskExecutionService = {
        register: jest.fn(),
        update: jest.fn(),
        registerCancelHandler: jest.fn(),
        unregisterCancelHandler: jest.fn(),
      };

      mockSettingsRepo = {
        findOne: jest.fn().mockResolvedValue({ language: 'pt-BR' }),
      };

      mockActivityBus = {
        publish: jest.fn(),
        events$: {
          subscribe: jest.fn((cb) => {
            mockActivityBus._cb = cb;
            return { unsubscribe: jest.fn() };
          }),
        },
      };

      mockPlayerSessions = {
        count: jest.fn().mockReturnValue(2),
      };

      service = new ServerShutdownWarningService(
        mockConsoleDriver,
        mockTaskExecutionService,
        mockSettingsRepo,
        mockActivityBus,
        mockPlayerSessions,
      );

      server = {
        id: 'srv-1',
        subdomain: 'survival',
        stop_warning_minutes: 10,
        minecraft_settings: { language: 'pt-BR' },
      } as any;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('pula a espera quando warningMinutes é 0', async () => {
      const onExecute = jest.fn();
      const res = await service.scheduleCountdown({
        server,
        action: 'stop',
        warningMinutes: 0,
        onExecute,
      });

      expect(res.scheduled).toBe(false);
      expect(mockConsoleDriver.sendCommand).not.toHaveBeenCalled();
      expect(onExecute).not.toHaveBeenCalled();
    });

    it('pula a espera quando listPlayers volta vazio', async () => {
      mockConsoleDriver.listPlayers.mockResolvedValue([]);
      const onExecute = jest.fn();

      const res = await service.scheduleCountdown({
        server,
        action: 'stop',
        warningMinutes: 10,
        onExecute,
      });

      expect(res.scheduled).toBe(false);
      expect(mockConsoleDriver.sendCommand).not.toHaveBeenCalled();
      expect(onExecute).not.toHaveBeenCalled();
    });

    it('com relógio falso: envia tellraw aos 10, 5 e 1 min, aos 30 s e aos 10 s, e só então chama onExecute (#204)', async () => {
      const onExecute = jest.fn().mockResolvedValue(undefined);

      const res = await service.scheduleCountdown({
        server,
        action: 'stop',
        warningMinutes: 10,
        onExecute,
      });

      expect(res.scheduled).toBe(true);
      expect(res.taskId).toBeDefined();

      // Marco 1: 10 min imediatamente no agendamento
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledTimes(1);
      expect(mockConsoleDriver.sendCommand).toHaveBeenLastCalledWith(
        server,
        expect.stringContaining('10 minutos'),
      );
      expect(onExecute).not.toHaveBeenCalled();

      // Avança 5 min (300_000 ms) -> Marco 2: 5 min restantes
      await jest.advanceTimersByTimeAsync(300_000);
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledTimes(2);
      expect(mockConsoleDriver.sendCommand).toHaveBeenLastCalledWith(
        server,
        expect.stringContaining('5 minutos'),
      );
      expect(onExecute).not.toHaveBeenCalled();

      // Avança 4 min (240_000 ms) -> Marco 3: 1 min restante
      await jest.advanceTimersByTimeAsync(240_000);
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledTimes(3);
      expect(mockConsoleDriver.sendCommand).toHaveBeenLastCalledWith(
        server,
        expect.stringContaining('1 minuto'),
      );
      expect(onExecute).not.toHaveBeenCalled();

      // Avança 30 s (30_000 ms) -> Marco 4: 30 s restantes
      await jest.advanceTimersByTimeAsync(30_000);
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledTimes(4);
      expect(mockConsoleDriver.sendCommand).toHaveBeenLastCalledWith(
        server,
        expect.stringContaining('30 segundos'),
      );
      expect(onExecute).not.toHaveBeenCalled();

      // Avança 20 s (20_000 ms) -> Marco 5: 10 s restantes
      await jest.advanceTimersByTimeAsync(20_000);
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledTimes(5);
      expect(mockConsoleDriver.sendCommand).toHaveBeenLastCalledWith(
        server,
        expect.stringContaining('10 segundos'),
      );
      expect(onExecute).not.toHaveBeenCalled();

      // Avança 10 s (10_000 ms) -> contagem termina e executa onExecute
      await jest.advanceTimersByTimeAsync(10_000);
      expect(onExecute).toHaveBeenCalledTimes(1);
      expect(service.hasActiveCountdown('srv-1')).toBe(false);
    });

    it('cancelar durante a contagem não chama onExecute e envia a mensagem de cancelamento (#204)', async () => {
      const onExecute = jest.fn();

      await service.scheduleCountdown({
        server,
        action: 'stop',
        warningMinutes: 10,
        onExecute,
      });

      // Avança até 5 min
      await jest.advanceTimersByTimeAsync(300_000);
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledWith(
        server,
        expect.stringContaining('5 minutos'),
      );

      // Cancela a contagem
      const cancelled = await service.cancelCountdown('srv-1');
      expect(cancelled).toBe(true);
      expect(mockConsoleDriver.sendCommand).toHaveBeenLastCalledWith(
        server,
        expect.stringContaining('A parada do servidor foi cancelada.'),
      );
      expect(mockTaskExecutionService.unregisterCancelHandler).toHaveBeenCalled();

      // Avança o restante do tempo
      await jest.advanceTimersByTimeAsync(600_000);
      expect(onExecute).not.toHaveBeenCalled();
      expect(service.hasActiveCountdown('srv-1')).toBe(false);
    });

    it('se todos os jogadores saírem nos primeiros 30 segundos, acorda imediatamente via ServerActivityBus (#204)', async () => {
      const onExecute = jest.fn().mockResolvedValue(undefined);

      await service.scheduleCountdown({
        server,
        action: 'stop',
        warningMinutes: 10,
        onExecute,
      });

      // Passam apenas 30 segundos (não 300 segundos)
      await jest.advanceTimersByTimeAsync(30_000);
      expect(onExecute).not.toHaveBeenCalled();

      // Jogadores saem aos 30 segundos
      mockPlayerSessions.count.mockReturnValue(0);
      mockConsoleDriver.listPlayers.mockResolvedValue([]);
      mockActivityBus._cb({ id: 'srv-1', kind: 'players' });

      // O timer é acordado imediatamente sem precisar esperar os 4.5 minutos restantes
      await jest.advanceTimersByTimeAsync(100);
      expect(onExecute).toHaveBeenCalledTimes(1);
      expect(service.hasActiveCountdown('srv-1')).toBe(false);
    });

    it('cancela contagem via taskId com cancelTask (#204)', async () => {
      const onExecute = jest.fn();
      const res = await service.scheduleCountdown({
        server,
        action: 'stop',
        warningMinutes: 10,
        onExecute,
      });

      expect(res.taskId).toBeDefined();
      const cancelled = await service.cancelTask(res.taskId!);
      expect(cancelled).toBe(true);
      expect(service.hasActiveCountdown('srv-1')).toBe(false);
    });

    it('se todos os jogadores desconectarem durante a contagem, finaliza sem esperar o restante do tempo (#204)', async () => {
      const onExecute = jest.fn().mockResolvedValue(undefined);

      await service.scheduleCountdown({
        server,
        action: 'stop',
        warningMinutes: 10,
        onExecute,
      });

      // Jogadores saem após o aviso de 5 minutos
      mockConsoleDriver.listPlayers.mockResolvedValue([]);

      // Avança 5 min
      await jest.advanceTimersByTimeAsync(300_000);

      // Imediatamente executa onExecute sem precisar esperar os outros 5 min
      expect(onExecute).toHaveBeenCalledTimes(1);
    });

    it('rejeita agendar outra contagem se uma já estiver em andamento (#204)', async () => {
      const onExecute = jest.fn();
      await service.scheduleCountdown({
        server,
        action: 'stop',
        warningMinutes: 10,
        onExecute,
      });

      await expect(
        service.scheduleCountdown({
          server,
          action: 'stop',
          warningMinutes: 5,
          onExecute,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
