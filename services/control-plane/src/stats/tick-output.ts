const DEFAULT_TARGET_TPS = 20;

export interface TickReading {
  tps: number | null;
  mspt: number | null;
}

function stripFormatting(output: string): string {
  return output.replace(/§./g, '');
}

/** Paper and Purpur: "TPS from last 1m, 5m, 15m: *20.0, 19.8, 19.9"; the first figure is the shortest window. */
export function parseTpsCommand(output: string): number | null {
  const match = /:\s*\*?(\d+(?:\.\d+)?)/.exec(stripFormatting(output));
  return match ? Number(match[1]) : null;
}

/** Vanilla 1.20.3+ `tick query`: "Average time per tick: 3.5ms (Target: 50.0ms)". */
export function parseTickQuery(output: string): TickReading {
  const text = stripFormatting(output);
  const msptMatch = /Average time per tick:\s*(\d+(?:\.\d+)?)\s*ms/i.exec(text);
  if (!msptMatch) {
    return { tps: null, mspt: null };
  }

  const mspt = Number(msptMatch[1]);
  const targetMatch = /Target tick rate:\s*(\d+(?:\.\d+)?)/i.exec(text);
  const target = targetMatch ? Number(targetMatch[1]) : DEFAULT_TARGET_TPS;
  const tps = mspt > 0 ? Math.min(target, 1000 / mspt) : target;
  return { tps, mspt };
}
