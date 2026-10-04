export const TPS_TARGET = 20;
export const TPS_HISTORY_LENGTH = 60;

export type TpsLevel = 'success' | 'warning' | 'danger';

/** 18+ is a healthy tick rate, below 15 players feel the lag. */
export function tpsLevel(tps: number): TpsLevel {
  if (tps >= 18) {
    return 'success';
  }
  return tps >= 15 ? 'warning' : 'danger';
}

/**
 * No endpoint reports MSPT. A tick takes 50 ms at 20 TPS only when saturated, so this inverse
 * relation only gives the placeholder a believable magnitude; it is never real data.
 */
export function placeholderMspt(tps: number): number {
  return Math.round((30 * TPS_TARGET) / Math.max(tps, 1));
}

/**
 * Placeholder TPS series for the last minute, ending at `currentTps`. Seeded by the server id so
 * the chart does not jump on every render. Replace with the real series once the API exists.
 */
export function placeholderTpsHistory(
  currentTps: number,
  seed: string,
  length = TPS_HISTORY_LENGTH,
): number[] {
  let state = 0;
  for (const char of seed) {
    state = (state * 31 + char.charCodeAt(0)) >>> 0;
  }
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return Array.from({ length }, (_, index) => {
    if (index === length - 1) {
      return currentTps;
    }
    const roll = next();
    const dip = roll > 0.93 ? 6 + next() * 8 : roll > 0.85 ? 1 + next() * 3 : next() * 0.4;
    return Math.min(TPS_TARGET, Math.max(0, currentTps - dip));
  });
}

export function formatHeap(usedMb: number, maxMb: number): string {
  const gib = (megabytes: number): string =>
    (megabytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return `${gib(usedMb)} / ${gib(maxMb)} GiB`;
}
