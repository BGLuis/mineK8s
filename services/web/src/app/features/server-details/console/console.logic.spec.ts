import { LogEntry } from '../../../core/api/models';
import { LocalLine, mergeConsoleLines, normalizeCommand } from './console.logic';

const entry = (id: string): LogEntry => ({
  id,
  timestamp: '2026-10-02T12:00:00Z',
  level: 'INFO',
  message: id,
});
const local = (message: string, afterId: string | null): LocalLine => ({
  timestamp: '2026-10-02T11:00:00Z',
  level: 'INFO',
  message,
  afterId,
});

describe('mergeConsoleLines', () => {
  it('puts local lines right after the server line they followed, whatever their timestamps say', () => {
    const merged = mergeConsoleLines(
      [entry('a'), entry('b'), entry('c')],
      [local('> list', 'b'), local('There are 2 players', 'b')],
    );

    expect(merged.map((line) => line.message)).toEqual([
      'a',
      'b',
      '> list',
      'There are 2 players',
      'c',
    ]);
  });

  it('puts lines whose anchor rolled off the buffer, or that came first, at the top', () => {
    const merged = mergeConsoleLines([entry('c')], [local('old', 'gone'), local('first', null)]);

    expect(merged.map((line) => line.message)).toEqual(['old', 'first', 'c']);
  });
});

describe('normalizeCommand', () => {
  it('drops the leading slash of the shortcuts', () => {
    expect(normalizeCommand('/time set day')).toBe('time set day');
    expect(normalizeCommand('  list ')).toBe('list');
  });
});
