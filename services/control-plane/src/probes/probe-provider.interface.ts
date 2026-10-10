export interface ProbeResult {
  ready: boolean;
  version?: string;
  /** Protocol number the server speaks (Minecraft: version.protocol of the status response). */
  protocol?: number;
  playersOnline?: number;
  maxPlayers?: number;
  latencyMs?: number;
  error?: string;
}

export interface GameProbeProvider {
  supports(gameType: string): boolean;
  probe(host: string, port: number, timeoutMs?: number): Promise<ProbeResult>;
}
