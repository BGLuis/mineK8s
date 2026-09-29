export interface ProbeResult {
  ready: boolean;
  version?: string;
  playersOnline?: number;
  maxPlayers?: number;
  latencyMs?: number;
  error?: string;
}

export interface GameProbeProvider {
  supports(gameType: string): boolean;
  probe(host: string, port: number, timeoutMs?: number): Promise<ProbeResult>;
}
