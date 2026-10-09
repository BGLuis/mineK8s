import { formatMemory, tpsLevel, tpsSeries } from './performance';

describe('tpsLevel', () => {
  it('is healthy from 18 TPS, degraded from 15 and critical below', () => {
    expect(tpsLevel(20)).toBe('success');
    expect(tpsLevel(18)).toBe('success');
    expect(tpsLevel(17.9)).toBe('warning');
    expect(tpsLevel(15)).toBe('warning');
    expect(tpsLevel(14.9)).toBe('danger');
  });
});

describe('tpsSeries', () => {
  it('keeps the order of the readings and skips samples without TPS instead of drawing them as zero', () => {
    const sample = (tps: number | null) => ({
      timestamp: '',
      tps,
      mspt: null,
      memoryUsedMb: null,
    });

    expect(tpsSeries([sample(20), sample(null), sample(14.5)])).toEqual([20, 14.5]);
  });
});

describe('formatMemory', () => {
  it('shows used against the container limit in GiB', () => {
    expect(formatMemory(3072, 5632)).toBe('3 / 5,5 GiB');
  });

  it('shows only the used value when the limit is unknown, and a dash when nothing is known', () => {
    expect(formatMemory(2048, null)).toBe('2 GiB');
    expect(formatMemory(null, 5632)).toBe('—');
  });
});
