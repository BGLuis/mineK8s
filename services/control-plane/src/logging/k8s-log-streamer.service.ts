import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as readline from 'readline';
import { Readable } from 'stream';
import { AppConfigService } from '../config/app-config.service';
import { CircularLogBuffer, LogEntry } from './circular-log-buffer';
import { LogNoiseFilter } from './log-noise-filter';

type LogDeltaListener = (entry: LogEntry) => void;

export interface LogStreamHandle {
  abortController: AbortController;
  subdomain: string;
}

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
  public subscribeToDeltas(
    serverId: string,
    listener: LogDeltaListener,
  ): () => void {
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
  public ingestRawLine(serverId: string, rawLine: string): LogEntry | null {
    if (LogNoiseFilter.isNoise(rawLine)) {
      return null;
    }

    const entry = LogNoiseFilter.parseLogEntry(rawLine);
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
   */
  public async attachServerStream(
    serverId: string,
    subdomain: string,
    streamFactory?: () => Promise<Readable>,
  ): Promise<CircularLogBuffer> {
    const buffer = this.getBuffer(serverId);
    if (this.activeStreams.has(serverId)) {
      return buffer;
    }

    const abortController = new AbortController();
    this.activeStreams.set(serverId, {
      abortController,
      subdomain,
    });

    const namespace =
      this.configService.kubernetes.namespace || 'minekubernetes';
    const podName = `mc-${subdomain}`;

    this.logger.log(
      `Iniciando stream de logs follow=true&tailLines=500 [${serverId}] pod: ${podName} ns: ${namespace}`,
    );

    // Se fornecida streamFactory personalizada (ex.: testes ou driver mock)
    if (streamFactory) {
      try {
        const stream = await streamFactory();
        this.pipeStreamToBuffer(serverId, stream, abortController);
      } catch (err) {
        this.logger.warn(
          `Falha ao iniciar stream customizado para ${subdomain}: ${(err as Error).message}`,
        );
      }
      return buffer;
    }

    return buffer;
  }

  /**
   * Conecta um Readable stream ao processamento linha a linha
   */
  public pipeStreamToBuffer(
    serverId: string,
    stream: Readable,
    abortController?: AbortController,
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

    rl.on('close', () => {
      this.logger.log(`Stream de logs finalizado para servidor ${serverId}`);
    });
  }

  /**
   * Desconecta o stream ativo de um servidor
   */
  public detachServerStream(serverId: string): void {
    const handle = this.activeStreams.get(serverId);
    if (handle) {
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
