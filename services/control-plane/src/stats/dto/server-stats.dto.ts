export interface StatsSample {
  timestamp: string;
  tps: number | null;
  mspt: number | null;
  memoryUsedMb: number | null;
}

export interface ServerStatsDto {
  window: string;
  tps: number | null;
  mspt: number | null;
  memoryUsedMb: number | null;
  memoryLimitMb: number | null;
  uptimeSeconds: number | null;
  history: StatsSample[];
}
