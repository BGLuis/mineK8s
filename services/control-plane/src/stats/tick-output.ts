const DEFAULT_TARGET_TPS = 20;

export interface TickReading {
  tps: number | null;
  mspt: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

const EMPTY_READING: TickReading = { tps: null, mspt: null, p50: null, p95: null, p99: null };

function stripFormatting(output: string): string {
  return output.replace(/§./g, '');
}

/** Paper and Purpur: "TPS from last 1m, 5m, 15m: *20.0, 19.8, 19.9"; the first figure is the shortest window. */
export function parseTpsCommand(output: string): number | null {
  const match = /:\s*\*?(\d+(?:\.\d+)?)/.exec(stripFormatting(output));
  return match ? Number(match[1]) : null;
}

/**
 * Vanilla 1.20.3+ `tick query`: "Average time per tick: 3.5ms (Target: 50.0ms)", then
 * "Percentiles: P50: 3.1ms P95: 9.8ms P99: 40.2ms, sample: 100".
 */
export function parseTickQuery(output: string): TickReading {
  const text = stripFormatting(output);
  const msptMatch = /Average time per tick:\s*(\d+(?:\.\d+)?)\s*ms/i.exec(text);
  if (!msptMatch) {
    return EMPTY_READING;
  }

  const mspt = Number(msptMatch[1]);
  const targetMatch = /Target tick rate:\s*(\d+(?:\.\d+)?)/i.exec(text);
  const target = targetMatch ? Number(targetMatch[1]) : DEFAULT_TARGET_TPS;
  const tps = mspt > 0 ? Math.min(target, 1000 / mspt) : target;
  return {
    tps,
    mspt,
    p50: percentile(text, 50),
    p95: percentile(text, 95),
    p99: percentile(text, 99),
  };
}

function percentile(text: string, rank: number): number | null {
  const match = new RegExp(`P${rank}:\\s*(\\d+(?:\\.\\d+)?)\\s*ms`).exec(text);
  return match ? Number(match[1]) : null;
}
