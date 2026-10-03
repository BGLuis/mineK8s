import { placeholderMspt, placeholderTpsHistory, tpsLevel } from './performance';

describe('tpsLevel', () => {
  it('is healthy from 18 TPS, degraded from 15 and critical below', () => {
    expect(tpsLevel(20)).toBe('success');
    expect(tpsLevel(18)).toBe('success');
    expect(tpsLevel(17.9)).toBe('warning');
    expect(tpsLevel(15)).toBe('warning');
    expect(tpsLevel(14.9)).toBe('danger');
  });
});

describe('placeholderTpsHistory', () => {
  it('has 60 bars within 0-20 and ends at the current TPS', () => {
    const series = placeholderTpsHistory(19.8, 'srv-1');

    expect(series).toHaveLength(60);
    expect(series.at(-1)).toBe(19.8);
    expect(Math.min(...series)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...series)).toBeLessThanOrEqual(20);
  });

  it('is stable for the same server so the chart does not flicker between renders', () => {
    expect(placeholderTpsHistory(19.8, 'srv-1')).toEqual(placeholderTpsHistory(19.8, 'srv-1'));
    expect(placeholderTpsHistory(19.8, 'srv-1')).not.toEqual(placeholderTpsHistory(19.8, 'srv-2'));
  });
});

describe('placeholderMspt', () => {
  it('grows as TPS drops and never divides by zero', () => {
    expect(placeholderMspt(20)).toBe(30);
    expect(placeholderMspt(10)).toBeGreaterThan(placeholderMspt(20));
    expect(Number.isFinite(placeholderMspt(0))).toBe(true);
  });
});
