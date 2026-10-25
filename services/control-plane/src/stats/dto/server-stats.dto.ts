export interface StatsSample {
  timestamp: string;
  tps: number | null;
  mspt: number | null;
  msptP95: number | null;
  msptP99: number | null;
  memoryUsedMb: number | null;
}

export interface ServerStatsDto {
  window: string;
  tps: number | null;
  mspt: number | null;
  msptP95: number | null;
  msptP99: number | null;
  memoryUsedMb: number | null;
  memoryLimitMb: number | null;
  /** -Xms/-Xmx the server boots with; the container limit adds room for the JVM outside the heap. */
  heapMb: number;
  uptimeSeconds: number | null;
  history: StatsSample[];
}
