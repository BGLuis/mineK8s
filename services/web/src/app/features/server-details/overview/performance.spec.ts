import {
  formatMemory,
  memoryVerdict,
  msptVerdict,
  tpsLevel,
  tpsSeries,
  tpsVerdict,
} from './performance';

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
      msptP95: null,
      msptP99: null,
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

describe('tpsVerdict', () => {
  it('says how much slower the game runs once players feel it', () => {
    expect(tpsVerdict(20)).toEqual({ level: 'success', text: 'No alvo de 20.' });
    expect(tpsVerdict(10)).toEqual({
      level: 'danger',
      text: 'O jogo roda a 50% da velocidade normal.',
    });
  });
});

describe('msptVerdict', () => {
  it('shows how much of the 50 ms budget a tick uses', () => {
    expect(msptVerdict(12.5, null)).toEqual({
      level: 'success',
      text: 'Cada tick usa 25% dos 50 ms disponíveis: sobra folga.',
    });
    expect(msptVerdict(40, null)?.level).toBe('warning');
    expect(msptVerdict(60, null)?.level).toBe('danger');
  });

  it('calls out spikes when the average is fine but the slowest ticks blow the budget', () => {
    const verdict = msptVerdict(15, 120);
    expect(verdict?.level).toBe('warning');
    expect(verdict?.text).toContain('1% dos ticks passa de 120 ms');
  });

  it('does not call out spikes that stay inside the budget', () => {
    expect(msptVerdict(15, 45)?.level).toBe('success');
  });

  it('says nothing without a reading', () => {
    expect(msptVerdict(null, 120)).toBeNull();
  });
});

describe('memoryVerdict', () => {
  it('treats high usage as expected, since the JVM reserves the whole heap at boot', () => {
    const verdict = memoryVerdict(4900, 5632, 4096);
    expect(verdict?.level).toBe('success');
    expect(verdict?.text).toContain('heap de 4 GiB');
  });

  it('warns near the container limit and flags the risk of OOMKill right at it', () => {
    expect(memoryVerdict(5100, 5632, 4096)?.level).toBe('warning');
    const critical = memoryVerdict(5400, 5632, 4096);
    expect(critical?.level).toBe('danger');
    expect(critical?.text).toContain('OOMKill');
  });

  it('says nothing without a reading or a limit', () => {
    expect(memoryVerdict(null, 5632, 4096)).toBeNull();
    expect(memoryVerdict(4900, null, 4096)).toBeNull();
  });
});
