import { ServerStatSample } from '../../../core/api/models';

export const TPS_TARGET = 20;

export type TpsLevel = 'success' | 'warning' | 'danger';

/** 18+ is a healthy tick rate, below 15 players feel the lag. */
export function tpsLevel(tps: number): TpsLevel {
  if (tps >= 18) {
    return 'success';
  }
  return tps >= 15 ? 'warning' : 'danger';
}

export function formatMemory(usedMb: number | null, limitMb: number | null): string {
  if (usedMb === null) {
    return '—';
  }
  const gib = (megabytes: number): string =>
    (megabytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return limitMb === null ? `${gib(usedMb)} GiB` : `${gib(usedMb)} / ${gib(limitMb)} GiB`;
}

/** TPS readings of the series, skipping samples where the server did not answer. */
export function tpsSeries(history: ServerStatSample[]): number[] {
  return history.flatMap((sample) => (sample.tps === null ? [] : [sample.tps]));
}
