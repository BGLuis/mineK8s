import { formatDuration } from './format';

describe('formatDuration', () => {
  it('shows hours and minutes once past an hour', () => {
    expect(formatDuration(2 * 3600 + 14 * 60 + 59)).toBe('2 h 14 min');
    expect(formatDuration(3600)).toBe('1 h 0 min');
  });

  it('shows only minutes under an hour', () => {
    expect(formatDuration(38 * 60)).toBe('38 min');
  });

  it('never shows 0 min', () => {
    expect(formatDuration(59)).toBe('menos de 1 min');
  });
});
