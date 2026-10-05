import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';
import { GameProbeProvider, ProbeResult } from './probe-provider.interface';

@Injectable()
export class MinecraftSlpProbeService implements GameProbeProvider {
  private readonly logger = new Logger(MinecraftSlpProbeService.name);

  supports(gameType: string): boolean {
    return !gameType || gameType.toLowerCase() === 'minecraft';
  }

  /**
   * Executes a native binary Server List Ping (SLP) handshake over TCP (RF-ARQ-04, C-14).
   * Validates that the Minecraft engine is fully loaded and accepting connections by
   * decoding the JSON status metadata containing version and player counts.
   */
  async probe(host: string, port: number = 25565, timeoutMs: number = 3000): Promise<ProbeResult> {
    const startTime = Date.now();

    return new Promise<ProbeResult>((resolve) => {
      let resolved = false;
      const socket = new net.Socket();

      const finish = (result: ProbeResult) => {
        if (resolved) return;
        resolved = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);

      socket.on('timeout', () => {
        finish({ ready: false, error: `SLP probe timeout after ${timeoutMs}ms` });
      });

      socket.on('error', (err) => {
        finish({ ready: false, error: `Socket error: ${err.message}` });
      });

      socket.on('close', () => {
        if (!resolved) {
          finish({ ready: false, error: 'Connection closed before status response received' });
        }
      });

      socket.connect(port, host, () => {
        try {
          // 1. Handshake Packet (ID 0x00, NextState = 1 [Status])
          const portBuf = Buffer.alloc(2);
          portBuf.writeUInt16BE(port, 0);

          const handshakePayload = Buffer.concat([
            this.encodeVarInt(0x00),
            this.encodeVarInt(765), // Minecraft 1.20.4 protocol version
            this.encodeString(host),
            portBuf,
            this.encodeVarInt(1), // Next state: 1 (Status)
          ]);
          const handshakePacket = Buffer.concat([
            this.encodeVarInt(handshakePayload.length),
            handshakePayload,
          ]);

          // 2. Status Request Packet (ID 0x00, empty payload)
          const requestPayload = this.encodeVarInt(0x00);
          const requestPacket = Buffer.concat([
            this.encodeVarInt(requestPayload.length),
            requestPayload,
          ]);

          socket.write(Buffer.concat([handshakePacket, requestPacket]));
        } catch (err: any) {
          finish({ ready: false, error: `Failed to construct SLP packet: ${err.message}` });
        }
      });

      let responseBuffer = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        responseBuffer = Buffer.concat([responseBuffer, chunk]);

        try {
          if (responseBuffer.length < 3) {
            return; // Wait for more data
          }

          let offset = 0;
          const { value: packetLength, bytesRead: lenBytes } = this.decodeVarInt(
            responseBuffer,
            offset,
          );
          offset += lenBytes;

          if (responseBuffer.length < offset + packetLength) {
            return; // Frame not complete yet
          }

          const { value: packetId, bytesRead: idBytes } = this.decodeVarInt(responseBuffer, offset);
          offset += idBytes;

          if (packetId !== 0x00) {
            finish({
              ready: false,
              error: `Invalid SLP response packet ID: 0x${packetId.toString(16)} (expected 0x00)`,
            });
            return;
          }

          const { value: jsonLength, bytesRead: jsonLenBytes } = this.decodeVarInt(
            responseBuffer,
            offset,
          );
          offset += jsonLenBytes;

          if (responseBuffer.length < offset + jsonLength) {
            return; // JSON string payload not complete
          }

          const jsonStr = responseBuffer.slice(offset, offset + jsonLength).toString('utf8');
          const parsed = JSON.parse(jsonStr);

          // C-14: Pod só é considerado Ready quando responder com metadados válidos de versão e jogadores
          if (!parsed.version || typeof parsed.players !== 'object') {
            finish({
              ready: false,
              error: 'SLP response missing version or players object',
            });
            return;
          }

          const latencyMs = Date.now() - startTime;
          finish({
            ready: true,
            version: parsed.version?.name || 'unknown',
            playersOnline: parsed.players?.online ?? 0,
            maxPlayers: parsed.players?.max ?? 0,
            latencyMs,
          });
        } catch (err: any) {
          if (err.message.includes('Unexpected EOF')) {
            // Need more data from socket
            return;
          }
          finish({ ready: false, error: `Failed to parse SLP response: ${err.message}` });
        }
      });
    });
  }

  encodeVarInt(val: number): Buffer {
    const bytes: number[] = [];
    let num = val;
    while (true) {
      if ((num & ~0x7f) === 0) {
        bytes.push(num);
        break;
      }
      bytes.push((num & 0x7f) | 0x80);
      num >>>= 7;
    }
    return Buffer.from(bytes);
  }

  encodeString(str: string): Buffer {
    const strBuf = Buffer.from(str, 'utf8');
    const lenBuf = this.encodeVarInt(strBuf.length);
    return Buffer.concat([lenBuf, strBuf]);
  }

  decodeVarInt(buf: Buffer, offset: number = 0): { value: number; bytesRead: number } {
    let value = 0;
    let bytesRead = 0;
    let b = 0;
    do {
      if (offset + bytesRead >= buf.length) {
        throw new Error('Unexpected EOF while decoding VarInt');
      }
      b = buf[offset + bytesRead];
      value |= (b & 0x7f) << (7 * bytesRead);
      bytesRead++;
      if (bytesRead > 5) {
        throw new Error('VarInt too large (> 5 bytes)');
      }
    } while ((b & 0x80) !== 0);
    return { value, bytesRead };
  }
}
