import { formatDateTime, formatRelative } from './format';

describe('formatRelative', () => {
  const now = new Date(2026, 9, 2, 12, 0, 0).getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('shows a dash when the device never connected', () => {
    expect(formatRelative(null, now)).toBe('—');
  });

  it.each([
    [10_000, 'agora'],
    [5 * 60_000, 'há 5 min'],
    [3 * 3_600_000, 'há 3 h'],
    [86_400_000, 'há 1 dia'],
    [3 * 86_400_000, 'há 3 dias'],
  ])('%i ms ago reads "%s"', (elapsed, expected) => {
    expect(formatRelative(ago(elapsed), now)).toBe(expected);
  });

  it('treats a timestamp in the future as now instead of a negative age', () => {
    expect(formatRelative(ago(-60_000), now)).toBe('agora');
  });
});

describe('formatDateTime', () => {
  it('writes the key expiry the way the join success card shows it', () => {
    expect(formatDateTime(new Date(2026, 9, 3, 14, 5).toISOString())).toBe('03/10 às 14:05');
  });
});
