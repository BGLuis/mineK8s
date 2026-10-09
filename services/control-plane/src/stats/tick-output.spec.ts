import { parseTickQuery, parseTpsCommand } from './tick-output';

describe('parseTpsCommand', () => {
  it('reads the first window of the Paper output, ignoring color codes and the cap marker', () => {
    expect(parseTpsCommand('§6TPS from last 1m, 5m, 15m: §a*20.0, §a19.8, §a19.9')).toBe(20);
  });

  it('keeps TPS below the cap as reported', () => {
    expect(parseTpsCommand('TPS from last 5s, 1m, 5m, 15m: 14.35, 17.9, 19.2, 19.8')).toBe(14.35);
  });

  it('returns null when the server does not know the command', () => {
    expect(parseTpsCommand('Unknown or incomplete command, see below for error')).toBeNull();
  });
});

describe('parseTickQuery', () => {
  const output = [
    'The game is running normally',
    'Target tick rate: 20.0 per second.',
    'Average time per tick: 12.5ms (Target: 50.0ms)',
  ].join('\n');

  it('reads MSPT and derives TPS from it', () => {
    expect(parseTickQuery(output)).toEqual({ tps: 20, mspt: 12.5 });
  });

  it('lets TPS drop once a tick takes longer than the target', () => {
    const slow = output.replace('12.5ms', '80.0ms');
    expect(parseTickQuery(slow)).toEqual({ tps: 12.5, mspt: 80 });
  });

  it('returns nulls for output that is not a tick report', () => {
    expect(parseTickQuery('Unknown or incomplete command')).toEqual({ tps: null, mspt: null });
  });
});
