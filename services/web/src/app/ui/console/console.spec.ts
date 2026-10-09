import { ConsoleLine, filterConsoleLines, formatClock, stripFormatting } from './console';

describe('console utilities', () => {
  describe('stripFormatting', () => {
    it('removes ANSI color codes and section signs', () => {
      const raw = '\u001b[32m§aHello §cWorld\u001b[0m';
      expect(stripFormatting(raw)).toBe('Hello World');
    });
  });

  describe('formatClock', () => {
    it('formats ISO timestamps to local time and preserves invalid strings', () => {
      expect(formatClock('not-a-date')).toBe('not-a-date');
      const formatted = formatClock('2026-10-09T15:30:00Z');
      expect(formatted).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
  });

  describe('filterConsoleLines', () => {
    const lines: ConsoleLine[] = [
      { timestamp: '1', level: 'INFO', message: 'stdout line', source: 'stdout' },
      { timestamp: '2', level: 'ERROR', message: 'stderr line', source: 'stderr' },
      { timestamp: '3', level: 'INFO', message: 'rcon command', source: 'rcon' },
      { timestamp: '4', level: 'WARN', message: 'unspecified source' },
    ];

    it('filters out rcon lines in logs mode', () => {
      const filtered = filterConsoleLines(lines, ['INFO', 'WARN', 'ERROR'], 'logs');
      expect(filtered.map((l) => l.message)).toEqual([
        'stdout line',
        'stderr line',
        'unspecified source',
      ]);
    });

    it('keeps only rcon lines in rcon mode', () => {
      const filtered = filterConsoleLines(lines, ['INFO', 'WARN', 'ERROR'], 'rcon');
      expect(filtered.map((l) => l.message)).toEqual(['rcon command']);
    });

    it('respects log level filters in both modes', () => {
      const logsWarnOnly = filterConsoleLines(lines, ['WARN'], 'logs');
      expect(logsWarnOnly.map((l) => l.message)).toEqual(['unspecified source']);

      const rconWarnOnly = filterConsoleLines(lines, ['WARN'], 'rcon');
      expect(rconWarnOnly).toEqual([]);
    });
  });
});
