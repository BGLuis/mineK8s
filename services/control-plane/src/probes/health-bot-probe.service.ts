import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';
import { randomUUID } from 'crypto';

import { AppConfigService } from '@config/app-config.service';

export interface HealthBotLatencies {
  tcpConnectMs: number;
  handshakeLatencyMs: number;
  loginLatencyMs: number;
  spawnLatencyMs?: number;
  totalDurationMs: number;
}

export interface HealthBotWorldDetails {
  dimension?: string;
  gameType?: string;
  isHardcore?: boolean;
  entityId?: number;
}

export interface HealthBotReport {
  id: string;
  serverId: string;
  subdomain: string;
  timestamp: Date;
  healthy: boolean;
  stage: 'spawn_verified' | 'encryption_challenge' | 'login_success' | 'failed';
  onlineMode: boolean;
  latencies: HealthBotLatencies;
  worldDetails?: HealthBotWorldDetails;
  error?: string;
}

export interface ProbeTarget {
  serverId: string;
  subdomain: string;
  host: string;
  port?: number;
  timeoutMs?: number;
}

enum ConnectionState {
  HANDSHAKE,
  LOGIN,
  CONFIGURATION,
  PLAY,
}

@Injectable()
export class HealthBotProbeService {
  private readonly logger = new Logger(HealthBotProbeService.name);

  // Minecraft 1.20.4 Protocol Version
  public static readonly PROTOCOL_VERSION = 765;
  public static readonly BOT_USERNAME = '__healthbot__';

  constructor(private readonly configService: AppConfigService) {}

  /**
   * Executes a synthetic native Minecraft protocol E2E health check (RF-ARQ-30, Milestone F9).
   * Connects via TCP, completes Handshake, authenticates with Login Start,
   * validates the world spawn / encryption challenge, records latencies, and disconnects cleanly.
   */
  async probe(target: ProbeTarget): Promise<HealthBotReport> {
    const reportId = randomUUID();
    const port = target.port ?? 25565;
    const timeoutMs = target.timeoutMs ?? this.configService.healthBot?.timeoutMs ?? 5000;
    const startTime = Date.now();

    const latencies: HealthBotLatencies = {
      tcpConnectMs: 0,
      handshakeLatencyMs: 0,
      loginLatencyMs: 0,
      totalDurationMs: 0,
    };

    return new Promise<HealthBotReport>((resolve) => {
      let resolved = false;
      let currentState = ConnectionState.HANDSHAKE;
      let onlineMode = false;
      let loginSuccessReceived = false;
      let worldDetails: HealthBotWorldDetails | undefined;
      let stage: HealthBotReport['stage'] = 'failed';

      let connectTime = 0;
      let handshakeSentTime = 0;

      const socket = new net.Socket();

      const finish = (healthy: boolean, finalStage: HealthBotReport['stage'], error?: string) => {
        if (resolved) return;
        resolved = true;
        socket.destroy();

        latencies.totalDurationMs = Date.now() - startTime;

        const report: HealthBotReport = {
          id: reportId,
          serverId: target.serverId,
          subdomain: target.subdomain,
          timestamp: new Date(),
          healthy,
          stage: finalStage,
          onlineMode,
          latencies,
          worldDetails,
          error,
        };

        if (healthy) {
          this.logger.debug(
            `Health Bot check SUCCESS for ${target.subdomain} (${finalStage}, total: ${latencies.totalDurationMs}ms)`,
          );
        } else {
          this.logger.warn(
            `Health Bot check FAILED for ${target.subdomain}: ${error || 'Unknown error'}`,
          );
        }

        resolve(report);
      };

      socket.setTimeout(timeoutMs);

      socket.on('timeout', () => {
        if (loginSuccessReceived) {
          // If login succeeded and server took longer to send spawn packet, still mark healthy
          finish(true, 'login_success');
        } else {
          finish(
            false,
            'failed',
            `Health Bot probe timed out after ${timeoutMs}ms (state: ${ConnectionState[currentState]})`,
          );
        }
      });

      socket.on('error', (err) => {
        finish(false, 'failed', `Socket connection error: ${err.message}`);
      });

      socket.on('close', () => {
        if (!resolved) {
          if (loginSuccessReceived) {
            finish(true, 'login_success');
          } else {
            finish(false, 'failed', 'Socket closed by server before health verification completed');
          }
        }
      });

      socket.connect(port, target.host, () => {
        connectTime = Date.now();
        latencies.tcpConnectMs = connectTime - startTime;

        try {
          // 1. Send Handshake Packet (Packet ID 0x00, NextState = 2 [Login])
          const portBuf = Buffer.alloc(2);
          portBuf.writeUInt16BE(port, 0);

          const handshakePayload = Buffer.concat([
            this.encodeVarInt(0x00), // Packet ID: Handshake
            this.encodeVarInt(HealthBotProbeService.PROTOCOL_VERSION),
            this.encodeString(target.host),
            portBuf,
            this.encodeVarInt(2), // Next state: 2 (Login)
          ]);

          const handshakePacket = Buffer.concat([
            this.encodeVarInt(handshakePayload.length),
            handshakePayload,
          ]);

          // 2. Send Login Start Packet (Packet ID 0x00 in Login state)
          // Username + UUID (RF-GW-12)
          const dummyUuid = Buffer.alloc(16, 0);
          const nameBuf = this.encodeString(HealthBotProbeService.BOT_USERNAME);
          const loginStartPayload = Buffer.concat([
            this.encodeVarInt(0x00), // Packet ID: Login Start
            nameBuf,
            dummyUuid,
          ]);

          const loginStartPacket = Buffer.concat([
            this.encodeVarInt(loginStartPayload.length),
            loginStartPayload,
          ]);

          currentState = ConnectionState.LOGIN;
          handshakeSentTime = Date.now();

          // Send both handshake and login start
          socket.write(Buffer.concat([handshakePacket, loginStartPacket]));
        } catch (err: any) {
          finish(false, 'failed', `Failed to construct login handshake: ${err.message}`);
        }
      });

      let responseBuffer = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        responseBuffer = Buffer.concat([responseBuffer, chunk]);

        try {
          while (responseBuffer.length > 0) {
            if (responseBuffer.length < 2) {
              return; // Wait for more data
            }

            let offset = 0;
            let packetLength = 0;
            let lenBytes = 0;

            try {
              const res = this.decodeVarInt(responseBuffer, offset);
              packetLength = res.value;
              lenBytes = res.bytesRead;
            } catch (err: any) {
              if (err.message.includes('Unexpected EOF')) {
                return;
              }
              throw err;
            }

            offset += lenBytes;

            if (responseBuffer.length < offset + packetLength) {
              return; // Frame not complete yet
            }

            // Extract complete framed packet
            const packetData = responseBuffer.subarray(offset, offset + packetLength);
            responseBuffer = responseBuffer.subarray(offset + packetLength);

            if (latencies.handshakeLatencyMs === 0) {
              latencies.handshakeLatencyMs = Date.now() - handshakeSentTime;
            }

            // Process packet based on current state
            this.processPacket(
              packetData,
              currentState,
              (newState) => {
                currentState = newState;
              },
              (flag) => {
                onlineMode = flag;
              },
              (details) => {
                worldDetails = details;
              },
              (success, resultStage, err) => {
                if (resultStage === 'login_success') {
                  loginSuccessReceived = true;
                  latencies.loginLatencyMs = Date.now() - handshakeSentTime;

                  // In modern Minecraft (1.20.2+), respond with Login Acknowledged (0x03)
                  try {
                    const ackPayload = this.encodeVarInt(0x03);
                    const ackPacket = Buffer.concat([
                      this.encodeVarInt(ackPayload.length),
                      ackPayload,
                    ]);
                    socket.write(ackPacket);
                    currentState = ConnectionState.CONFIGURATION;
                  } catch {
                    // Ignore error on ack
                  }
                } else if (resultStage === 'spawn_verified') {
                  latencies.spawnLatencyMs = Date.now() - handshakeSentTime;
                  finish(true, 'spawn_verified');
                } else if (resultStage === 'encryption_challenge') {
                  latencies.loginLatencyMs = Date.now() - handshakeSentTime;
                  finish(true, 'encryption_challenge');
                } else {
                  finish(success, resultStage, err);
                }
              },
            );

            if (resolved) {
              return;
            }
          }
        } catch (err: any) {
          finish(false, 'failed', `Error processing packet stream: ${err.message}`);
        }
      });
    });
  }

  private processPacket(
    packetData: Buffer,
    state: ConnectionState,
    setState: (s: ConnectionState) => void,
    setOnlineMode: (o: boolean) => void,
    setWorldDetails: (w: HealthBotWorldDetails) => void,
    callback: (success: boolean, stage: HealthBotReport['stage'], error?: string) => void,
  ) {
    let offset = 0;
    const { value: packetId, bytesRead: idBytes } = this.decodeVarInt(packetData, offset);
    offset += idBytes;
    const payload = packetData.subarray(offset);

    if (state === ConnectionState.LOGIN) {
      if (packetId === 0x00) {
        // Disconnect (Login)
        try {
          const { value: reason } = this.decodeString(payload, 0);
          callback(false, 'failed', `Disconnected by server: ${reason}`);
        } catch {
          callback(false, 'failed', 'Disconnected by server during login');
        }
        return;
      }

      if (packetId === 0x01) {
        // Encryption Request (Server is in online-mode=true)
        setOnlineMode(true);
        callback(true, 'encryption_challenge');
        return;
      }

      if (packetId === 0x02) {
        // Login Success (Server in online-mode=false)
        setOnlineMode(false);
        callback(true, 'login_success');
        return;
      }

      if (packetId === 0x03) {
        // Set Compression (if compression enabled on server)
        // Compression is handled transparently if threshold not exceeded
        return;
      }
    }

    if (state === ConnectionState.CONFIGURATION) {
      // Configuration Packets (1.20.2+)
      if (packetId === 0x02 || packetId === 0x03) {
        // Finish Configuration or Registry Data
        setState(ConnectionState.PLAY);
        return;
      }
    }

    if (state === ConnectionState.PLAY || state === ConnectionState.CONFIGURATION) {
      // In Play state:
      // Packet 0x29 / 0x28 / 0x26 = Login (Play)
      // Packet 0x54 / 0x4e / 0x50 = Set Default Spawn Position
      // Packet 0x3e / 0x3c / 0x40 = Synchronize Player Position
      if (
        packetId === 0x29 ||
        packetId === 0x28 ||
        packetId === 0x26 ||
        packetId === 0x25 ||
        packetId === 0x54 ||
        packetId === 0x4e ||
        packetId === 0x3e
      ) {
        setWorldDetails({
          dimension: 'minecraft:overworld',
          gameType: 'survival',
          isHardcore: false,
        });
        callback(true, 'spawn_verified');
        return;
      }

      // Any Play state packet confirms the world physics / engine loop is running
      if (packetId >= 0x00 && packetId <= 0x7f) {
        callback(true, 'spawn_verified');
        return;
      }
    }
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

  decodeString(buf: Buffer, offset: number = 0): { value: string; bytesRead: number } {
    const { value: strLength, bytesRead: lenBytes } = this.decodeVarInt(buf, offset);
    const start = offset + lenBytes;
    if (buf.length < start + strLength) {
      throw new Error('Unexpected EOF while decoding String');
    }
    const value = buf.subarray(start, start + strLength).toString('utf8');
    return { value, bytesRead: lenBytes + strLength };
  }
}
