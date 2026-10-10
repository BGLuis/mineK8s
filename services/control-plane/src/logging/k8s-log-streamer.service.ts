import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as readline from 'readline';
import { Readable } from 'stream';
import { AppConfigService } from '../config/app-config.service';
import { serverWorkloadName } from '../k8s/resource-names';
import { CircularLogBuffer, LogEntry, LogSource } from './circular-log-buffer';
import { LogNoiseFilter } from './log-noise-filter';

type LogDeltaListener = (entry: LogEntry) => void;

export interface LogStreamHandle {
  abortController: AbortController;
  resourceName: string;
  retryTimer?: NodeJS.Timeout;
}

export interface AttachStreamOptions {
  /** Called when the pod's stream ends or has no pod yet: false means nobody is watching, so stop following. */
  shouldRetry?: () => boolean;
  retryDelayMs?: number;
}

const DEFAULT_RETRY_DELAY_MS = 5000;

@Injectable()
export class K8sLogStreamerService implements OnModuleDestroy {
  private readonly logger = new Logger(K8sLogStreamerService.name);
  private readonly buffers = new Map<string, CircularLogBuffer>();
  private readonly activeStreams = new Map<string, LogStreamHandle>();
  private readonly listeners = new Map<string, Set<LogDeltaListener>>();

  constructor(private readonly configService: AppConfigService) {}

  /**
   * Obtém ou inicializa o buffer circular de 500 posições para o servidor (RF-RCON-08).
   */
  public getBuffer(serverId: string): CircularLogBuffer {
    let buffer = this.buffers.get(serverId);
    if (!buffer) {
      buffer = new CircularLogBuffer(500);
      this.buffers.set(serverId, buffer);
    }
    return buffer;
  }

  /**
   * Registra um listener para novos deltas de log aprovados pelo filtro (RF-RCON-09).
   */
  public subscribeToDeltas(serverId: string, listener: LogDeltaListener): () => void {
    let set = this.listeners.get(serverId);
    if (!set) {
      set = new Set();
      this.listeners.set(serverId, set);
    }
    set.add(listener);

    return () => {
      set?.delete(listener);
      if (set?.size === 0) {
        this.listeners.delete(serverId);
      }
    };
  }

  /**
   * Processa uma linha bruta de log (filtrando ruído RCON e sanitizando ANSI).
   */
  public ingestRawLine(
    serverId: string,
    rawLine: string,
    source: LogSource = 'stdout',
  ): LogEntry | null {
    if (LogNoiseFilter.isNoise(rawLine)) {
      return null;
    }

    const entry = LogNoiseFilter.parseLogEntry(rawLine, undefined, source);
    const buffer = this.getBuffer(serverId);
    buffer.push(entry);

    // Notifica clientes inscritos na sala
    const serverListeners = this.listeners.get(serverId);
    if (serverListeners) {
      for (const listener of serverListeners) {
        try {
          listener(entry);
        } catch (err) {
          this.logger.error(
            `Erro ao despachar log_delta para servidor ${serverId}: ${(err as Error).message}`,
          );
        }
      }
    }

    return entry;
  }

  /**
   * Conecta stream contínuo de logs de pod k8s (RF-RCON-07, Guarda C-11).
   * `streamFactory` abre o log do pod ou devolve null quando ele não existe; o stream é reaberto
   * enquanto `shouldRetry` disser que há quem acompanhe, já que o pod é substituído a cada partida.
   */
  public async attachServerStream(
    serverId: string,
    resourceName: string,
    streamFactory?: () => Promise<Readable | null>,
    options: AttachStreamOptions = {},
  ): Promise<CircularLogBuffer> {
    const buffer = this.getBuffer(serverId);
    if (this.activeStreams.has(serverId)) {
      return buffer;
    }

    const handle: LogStreamHandle = { abortController: new AbortController(), resourceName };
    this.activeStreams.set(serverId, handle);

    const namespace = this.configService.kubernetes.namespace || 'minekubernetes';
    const podName = serverWorkloadName(resourceName);

    this.logger.log(
      `Iniciando stream de logs follow=true&tailLines=500 [${serverId}] pod: ${podName} ns: ${namespace}`,
    );

    if (streamFactory) {
      await this.openStream(serverId, handle, streamFactory, options);
    }
    return buffer;
  }

  private async openStream(
    serverId: string,
    handle: LogStreamHandle,
    streamFactory: () => Promise<Readable | null>,
    options: AttachStreamOptions,
  ): Promise<void> {
    let stream: Readable | null = null;
    try {
      stream = await streamFactory();
    } catch (err) {
      this.logger.warn(
        `Falha ao abrir o stream de logs de ${handle.resourceName}: ${(err as Error).message}`,
      );
    }

    if (handle.abortController.signal.aborted) {
      stream?.destroy();
      return;
    }
    if (!stream) {
      this.scheduleReopen(serverId, handle, streamFactory, options);
      return;
    }

    // The new pod's log starts over; the previous pod's lines would only be stale history.
    this.clearBuffer(serverId);
    this.pipeStreamToBuffer(serverId, stream, handle.abortController, () =>
      this.scheduleReopen(serverId, handle, streamFactory, options),
    );
  }

  private scheduleReopen(
    serverId: string,
    handle: LogStreamHandle,
    streamFactory: () => Promise<Readable | null>,
    options: AttachStreamOptions,
  ): void {
    if (handle.abortController.signal.aborted) {
      return;
    }
    if (!options.shouldRetry?.()) {
      // Nobody is following: the next attach starts again.
      this.activeStreams.delete(serverId);
      return;
    }
    handle.retryTimer = setTimeout(
      () => void this.openStream(serverId, handle, streamFactory, options),
      options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    );
    handle.retryTimer.unref();
  }

  /**
   * Conecta um Readable stream ao processamento linha a linha
   */
  public pipeStreamToBuffer(
    serverId: string,
    stream: Readable,
    abortController?: AbortController,
    onEnd?: () => void,
  ): void {
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    rl.on('line', (line: string) => {
      if (abortController?.signal.aborted) {
        rl.close();
        return;
      }
      this.ingestRawLine(serverId, line);
    });

    stream.on('error', (err) => {
      this.logger.warn(`Erro no stream de logs do servidor ${serverId}: ${err.message}`);
      rl.close();
    });

    rl.on('close', () => {
      this.logger.log(`Stream de logs finalizado para servidor ${serverId}`);
      onEnd?.();
    });
  }

  /**
   * Desconecta o stream ativo de um servidor
   */
  public detachServerStream(serverId: string): void {
    const handle = this.activeStreams.get(serverId);
    if (handle) {
      clearTimeout(handle.retryTimer);
      handle.abortController.abort();
      this.activeStreams.delete(serverId);
      this.logger.log(`Stream de logs cancelado para servidor ${serverId}`);
    }
  }

  public clearBuffer(serverId: string): void {
    this.buffers.get(serverId)?.clear();
  }

  onModuleDestroy(): void {
    for (const [serverId] of this.activeStreams) {
      this.detachServerStream(serverId);
    }
    this.buffers.clear();
    this.listeners.clear();
  }
}
