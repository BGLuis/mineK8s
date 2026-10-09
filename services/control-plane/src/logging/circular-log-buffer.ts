export type LogSource = 'stdout' | 'stderr' | 'rcon';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  source?: LogSource;
}

/**
 * Buffer circular de alta performance em memória para logs de servidor (RF-RCON-08).
 * Inserção em O(1) e extração cronológica em O(N) com zero realocação contínua de memória.
 */
export class CircularLogBuffer {
  private readonly capacity: number;
  private readonly buffer: (LogEntry | null)[];
  private writePointer: number = 0;
  private isFull: boolean = false;

  constructor(capacity: number = 500) {
    this.capacity = capacity;
    this.buffer = new Array<LogEntry | null>(capacity).fill(null);
  }

  public push(entry: LogEntry): void {
    this.buffer[this.writePointer] = entry;
    this.writePointer = (this.writePointer + 1) % this.capacity;
    if (this.writePointer === 0) {
      this.isFull = true;
    }
  }

  public getHistory(): LogEntry[] {
    if (!this.isFull) {
      return this.buffer.slice(0, this.writePointer) as LogEntry[];
    }
    return [
      ...(this.buffer.slice(this.writePointer) as LogEntry[]),
      ...(this.buffer.slice(0, this.writePointer) as LogEntry[]),
    ];
  }

  public size(): number {
    return this.isFull ? this.capacity : this.writePointer;
  }

  public clear(): void {
    this.buffer.fill(null);
    this.writePointer = 0;
    this.isFull = false;
  }
}
