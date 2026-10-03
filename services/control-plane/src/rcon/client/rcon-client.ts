import * as net from 'net';
import { Logger } from '@nestjs/common';
import {
  RconPacket,
  RconPacketCodec,
  RconPacketType,
} from '../codec/rcon-packet.codec';

export class RconTimeoutException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RconTimeoutException';
  }
}

export class RconAuthenticationException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RconAuthenticationException';
  }
}

export enum RconConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  AUTHENTICATING = 'AUTHENTICATING',
  CONNECTED = 'CONNECTED',
  AUTH_FAILED = 'AUTH_FAILED',
}

export interface RconClientOptions {
  host: string;
  port: number;
  password: string;
  serverId: string;
  defaultTimeoutMs?: number; // Default 5000 ms (Guarda L-08)
  baseBackoffMs?: number; // 1000 ms (RF-RCON-06)
  maxBackoffMs?: number; // 15000 ms (RF-RCON-06)
  autoReconnect?: boolean;
  createSocket?: () => net.Socket;
}

interface QueuedCommand {
  command: string;
  timeoutMs: number;
  resolve: (response: string) => void;
  reject: (reason: any) => void;
}

export class RconClient {
  private readonly logger = new Logger(RconClient.name);
  private socket: net.Socket | null = null;
  private state: RconConnectionState = RconConnectionState.DISCONNECTED;
  private accumulator: Buffer = Buffer.alloc(0);
  private requestIdCounter = 1;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;

  // Single-flight FIFO command queue (RF-RCON-04)
  private readonly commandQueue: QueuedCommand[] = [];
  private activeCommand: {
    command: QueuedCommand;
    requestId: number;
    timer: NodeJS.Timeout;
  } | null = null;

  private authRequestId: number | null = null;

  constructor(private readonly options: RconClientOptions) {
    this.options.defaultTimeoutMs = this.options.defaultTimeoutMs ?? 5000;
    this.options.baseBackoffMs = this.options.baseBackoffMs ?? 1000;
    this.options.maxBackoffMs = this.options.maxBackoffMs ?? 15000;
    this.options.autoReconnect = this.options.autoReconnect ?? true;
  }

  public getState(): RconConnectionState {
    return this.state;
  }

  public isConnected(): boolean {
    return this.state === RconConnectionState.CONNECTED;
  }

  /**
   * Conecta ao servidor TCP e efetua o handshake de autenticação (RF-RCON-03).
   */
  public async connect(): Promise<void> {
    if (
      this.state === RconConnectionState.CONNECTED ||
      this.state === RconConnectionState.CONNECTING ||
      this.state === RconConnectionState.AUTHENTICATING
    ) {
      return;
    }

    this.isDestroyed = false;
    this.state = RconConnectionState.CONNECTING;
    this.clearReconnectTimer();

    return new Promise((resolve, reject) => {
      const socket = this.options.createSocket
        ? this.options.createSocket()
        : new net.Socket();
      this.socket = socket;

      const connectErrorHandler = (err: Error) => {
        this.logger.warn(
          `Falha ao conectar socket RCON [${this.options.serverId}] ${this.options.host}:${this.options.port}: ${err.message}`,
        );
        this.handleDisconnect();
        reject(err);
      };

      socket.once('error', connectErrorHandler);

      socket.connect(this.options.port, this.options.host, () => {
        socket.removeListener('error', connectErrorHandler);
        this.attachSocketListeners(socket);
        this.authenticate()
          .then(() => resolve())
          .catch((err) => reject(err));
      });
    });
  }

  /**
   * Despacha comando com fila FIFO single-flight, timeout abortable e guarda L-08.
   */
  public sendCommand(command: string, timeoutMs?: number): Promise<string> {
    if (this.isDestroyed) {
      return Promise.reject(new Error('RconClient was destroyed'));
    }

    return new Promise<string>((resolve, reject) => {
      const queuedCmd: QueuedCommand = {
        command,
        timeoutMs: timeoutMs ?? this.options.defaultTimeoutMs ?? 5000,
        resolve,
        reject,
      };

      this.commandQueue.push(queuedCmd);
      this.processQueue();
    });
  }

  /**
   * Desconecta e destrói o socket forçosamente, cancelando comandos pendentes.
   */
  public destroy(): void {
    this.isDestroyed = true;
    this.clearReconnectTimer();
    this.failPendingCommands(new Error('RconClient destroyed'));

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }

    this.state = RconConnectionState.DISCONNECTED;
  }

  private attachSocketListeners(socket: net.Socket): void {
    socket.on('data', (chunk: Buffer) => {
      this.accumulator = Buffer.concat([this.accumulator, chunk]);
      this.processAccumulator();
    });

    socket.on('error', (err: Error) => {
      this.logger.warn(
        `Erro de socket RCON [${this.options.serverId}]: ${err.message}`,
      );
    });

    socket.on('close', () => {
      this.handleDisconnect();
    });
  }

  private async authenticate(): Promise<void> {
    this.state = RconConnectionState.AUTHENTICATING;
    const authId = this.nextRequestId();
    this.authRequestId = authId;

    const packet = RconPacketCodec.encode({
      id: authId,
      type: RconPacketType.SERVERDATA_AUTH,
      body: this.options.password,
    });

    return new Promise((resolve, reject) => {
      const authTimeout = setTimeout(() => {
        this.forceResetSocket(
          new RconTimeoutException('Timeout during RCON authentication'),
        );
        reject(new RconTimeoutException('Timeout during RCON authentication'));
      }, this.options.defaultTimeoutMs);

      const checkAuth = (packet: RconPacket) => {
        if (
          packet.type === RconPacketType.SERVERDATA_AUTH_RESPONSE ||
          packet.type === RconPacketType.SERVERDATA_RESPONSE_VALUE
        ) {
          if (packet.id === -1) {
            clearTimeout(authTimeout);
            this.state = RconConnectionState.AUTH_FAILED;
            this.logger.error(
              `Autenticação RCON recusada para servidor ${this.options.serverId}: Senha inválida`,
            );
            this.forceResetSocket(
              new RconAuthenticationException('RCON password invalid'),
            );
            reject(new RconAuthenticationException('RCON password invalid'));
            return true;
          }

          if (packet.id === authId) {
            clearTimeout(authTimeout);
            this.state = RconConnectionState.CONNECTED;
            this.reconnectAttempts = 0;
            this.logger.log(
              `RCON autenticado e conectado com sucesso [${this.options.serverId}]`,
            );
            resolve();
            this.processQueue();
            return true;
          }
        }
        return false;
      };

      this.pendingAuthHandler = checkAuth;
      this.socket?.write(packet);
    });
  }

  private pendingAuthHandler: ((packet: RconPacket) => boolean) | null = null;

  private processAccumulator(): void {
    try {
      while (this.accumulator.length >= 14) {
        const decoded = RconPacketCodec.decode(this.accumulator);
        if (!decoded) {
          break; // Pacote incompleto
        }

        this.accumulator = this.accumulator.subarray(decoded.bytesConsumed);
        this.handleIncomingPacket(decoded.packet);
      }
    } catch (err) {
      this.logger.error(
        `Erro no processamento do fluxo RCON: ${(err as Error).message}`,
      );
      this.forceResetSocket(err as Error);
    }
  }

  private handleIncomingPacket(packet: RconPacket): void {
    if (this.pendingAuthHandler && this.pendingAuthHandler(packet)) {
      this.pendingAuthHandler = null;
      return;
    }

    if (this.activeCommand && this.activeCommand.requestId === packet.id) {
      clearTimeout(this.activeCommand.timer);
      const { resolve } = this.activeCommand.command;
      this.activeCommand = null;
      resolve(packet.body);
      this.processQueue();
    }
  }

  private processQueue(): void {
    if (this.state !== RconConnectionState.CONNECTED || this.activeCommand) {
      return;
    }

    const next = this.commandQueue.shift();
    if (!next) {
      return;
    }

    const requestId = this.nextRequestId();
    let packetBuffer: Buffer;
    try {
      packetBuffer = RconPacketCodec.encode({
        id: requestId,
        type: RconPacketType.SERVERDATA_EXECCOMMAND,
        body: next.command,
      });
    } catch (err) {
      next.reject(err);
      this.processQueue();
      return;
    }

    // RF-RCON-05 & Guarda L-08: Timeout determinístico por comando
    const timer = setTimeout(() => {
      this.logger.warn(
        `Timeout RCON (${next.timeoutMs}ms) ao executar comando: "${next.command}" no servidor ${this.options.serverId}`,
      );
      const timeoutErr = new RconTimeoutException(
        `RCON command timed out after ${next.timeoutMs}ms`,
      );
      next.reject(timeoutErr);
      this.forceResetSocket(timeoutErr);
    }, next.timeoutMs);

    this.activeCommand = {
      command: next,
      requestId,
      timer,
    };

    this.socket?.write(packetBuffer);
  }

  /**
   * RF-RCON-05: Em caso de timeout ou erro estrutural, destroi o socket e reconecta
   */
  private forceResetSocket(error: Error): void {
    if (this.activeCommand) {
      clearTimeout(this.activeCommand.timer);
      this.activeCommand.command.reject(error);
      this.activeCommand = null;
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }

    this.accumulator = Buffer.alloc(0);
    this.handleDisconnect();
  }

  private handleDisconnect(): void {
    const wasAuthFailed = this.state === RconConnectionState.AUTH_FAILED;
    this.state = RconConnectionState.DISCONNECTED;
    this.failPendingCommands(new Error('RCON connection closed'));

    if (
      !this.isDestroyed &&
      this.options.autoReconnect &&
      !wasAuthFailed
    ) {
      this.scheduleReconnect();
    }
  }

  private failPendingCommands(reason: Error): void {
    if (this.activeCommand) {
      clearTimeout(this.activeCommand.timer);
      this.activeCommand.command.reject(reason);
      this.activeCommand = null;
    }
    while (this.commandQueue.length > 0) {
      const cmd = this.commandQueue.shift();
      cmd?.reject(reason);
    }
  }

  /**
   * RF-RCON-06: Backoff exponencial 1–15 s com jitter
   */
  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const base = this.options.baseBackoffMs!;
    const max = this.options.maxBackoffMs!;
    const attempt = Math.min(this.reconnectAttempts, 6);
    const exponential = Math.min(max, base * Math.pow(2, attempt));

    // Jitter: +/- 20%
    const jitter = (Math.random() * 0.4 - 0.2) * exponential;
    const delay = Math.max(base, Math.round(exponential + jitter));

    this.reconnectAttempts++;
    this.logger.log(
      `Agendando reconexão RCON para servidor ${this.options.serverId} em ${delay}ms (tentativa ${this.reconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // Erro já capturado internamente, re-agendará pelo handleDisconnect
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private nextRequestId(): number {
    this.requestIdCounter = (this.requestIdCounter + 1) & 0x7fffffff;
    if (this.requestIdCounter === 0) {
      this.requestIdCounter = 1;
    }
    return this.requestIdCounter;
  }
}
