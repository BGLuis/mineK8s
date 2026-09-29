import { CircularLogBuffer, LogEntry } from './circular-log-buffer';
import { LogNoiseFilter } from './log-noise-filter';

describe('Log Pipeline Components (RF-RCON-08, RF-RCON-09, RF-RCON-15)', () => {
  describe('CircularLogBuffer (RF-RCON-08)', () => {
    it('test_ring_buffer_fifo_preservation: should maintain exact 500 most recent lines in order when 700 lines are pushed', () => {
      const buffer = new CircularLogBuffer(500);

      // Push 700 lines numbered 1 to 700
      for (let i = 1; i <= 700; i++) {
        buffer.push({
          id: `line-${i}`,
          timestamp: '12:00:00',
          level: 'INFO',
          message: `Log line number ${i}`,
        });
      }

      expect(buffer.size()).toBe(500);

      const history = buffer.getHistory();
      expect(history.length).toBe(500);

      // The oldest retained entry must be line 201
      expect(history[0].id).toBe('line-201');
      expect(history[0].message).toBe('Log line number 201');

      // The newest entry must be line 700
      expect(history[499].id).toBe('line-700');
      expect(history[499].message).toBe('Log line number 700');

      // Verify strict sequential ordering across wrap boundary
      for (let i = 0; i < 500; i++) {
        expect(history[i].message).toBe(`Log line number ${201 + i}`);
      }
    });

    it('should return all lines when less than capacity is added', () => {
      const buffer = new CircularLogBuffer(500);
      buffer.push({
        id: '1',
        timestamp: '10:00:00',
        level: 'INFO',
        message: 'First entry',
      });
      buffer.push({
        id: '2',
        timestamp: '10:00:01',
        level: 'WARN',
        message: 'Second entry',
      });

      expect(buffer.size()).toBe(2);
      const history = buffer.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].message).toBe('First entry');
      expect(history[1].message).toBe('Second entry');
    });
  });

  describe('LogNoiseFilter (RF-RCON-09)', () => {
    it('test_noise_filter_rcon_suppression: should identify and suppress internal RCON thread messages', () => {
      const noiseLines = [
        'Thread RCON Client /10.244.0.1:45123 started',
        'Thread RCON Client /10.244.0.1:45123 shut down',
        'RCON Client /10.244.0.1:45123 shut down',
        'RCON connection from: /127.0.0.1:55432',
        'Steve logged in via rcon',
        'Failed to handle packet SERVERDATA_EXECCOMMAND',
      ];

      for (const line of noiseLines) {
        expect(LogNoiseFilter.isNoise(line)).toBe(true);
      }
    });

    it('test_noise_filter_preserves_game_chat: should NOT suppress player chat discussing RCON', () => {
      const chatLines = [
        '<Steve> Você configurou o rcon da base?',
        '[Server thread/INFO]: <Alex> Thread RCON Client no chat nao deve sumir!',
        '[12:30:15 INFO]: <Notch> logged in via rcon eh muito facil',
        '[Not Secure] <Player99> preciso de ajuda com rcon connection from',
      ];

      for (const line of chatLines) {
        expect(LogNoiseFilter.isNoise(line)).toBe(false);
      }
    });

    it('should sanitize ANSI terminal codes cleanly', () => {
      const ansiLine = '\u001b[32m[Server thread/INFO]\u001b[0m: Done (2.41s)!';
      const clean = LogNoiseFilter.sanitizeAnsi(ansiLine);
      expect(clean).toBe('[Server thread/INFO]: Done (2.41s)!');
    });

    it('should parse log entry with correct level and timestamp', () => {
      const raw = '[14:05:30] [Server thread/WARN]: Can\'t keep up! Is the server overloaded?';
      const entry = LogNoiseFilter.parseLogEntry(raw, 'entry-1');

      expect(entry.id).toBe('entry-1');
      expect(entry.level).toBe('WARN');
      expect(entry.timestamp).toBe('14:05:30');
      expect(entry.message).toContain('Can\'t keep up!');
    });
  });
});
