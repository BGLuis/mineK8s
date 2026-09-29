import { Injectable } from '@nestjs/common';
import * as net from 'net';
import { GameProbeProvider, ProbeResult } from './probe-provider.interface';

@Injectable()
export class GenericTcpProbeService implements GameProbeProvider {
  supports(gameType: string): boolean {
    return !!gameType && gameType.toLowerCase() !== 'minecraft';
  }

  async probe(host: string, port: number, timeoutMs: number = 3000): Promise<ProbeResult> {
    const startTime = Date.now();

    return new Promise<ProbeResult>((resolve) => {
      const socket = new net.Socket();
      let resolved = false;

      const finish = (result: ProbeResult) => {
        if (resolved) return;
        resolved = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);

      socket.on('timeout', () => {
        finish({ ready: false, error: `TCP probe timeout after ${timeoutMs}ms` });
      });

      socket.on('error', (err) => {
        finish({ ready: false, error: `Socket error: ${err.message}` });
      });

      socket.connect(port, host, () => {
        const latencyMs = Date.now() - startTime;
        finish({
          ready: true,
          latencyMs,
        });
      });
    });
  }
}
