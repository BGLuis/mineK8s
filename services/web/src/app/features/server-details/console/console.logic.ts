import { LogEntry } from '../../../core/api/models';
import { ConsoleLine } from '../../../ui';

/** A line produced on this client (command echo or its output), anchored to the server log. */
export interface LocalLine extends ConsoleLine {
  /** Id of the last server line seen when this one was created; null when the log was empty. */
  afterId: string | null;
}

/**
 * Interleaves local lines into the server log without trusting clocks: each local line goes right
 * after the server line it followed. If that line already rolled off the buffer, it is older than
 * everything left, so it goes first.
 */
export function mergeConsoleLines(
  server: readonly LogEntry[],
  local: readonly LocalLine[],
): ConsoleLine[] {
  if (local.length === 0) {
    return [...server];
  }
  const indexById = new Map(server.map((line, index) => [line.id, index]));
  const slots = new Map<number, ConsoleLine[]>();
  for (const line of local) {
    const slot = line.afterId === null ? -1 : (indexById.get(line.afterId) ?? -1);
    slots.set(slot, [...(slots.get(slot) ?? []), line]);
  }
  return [
    ...(slots.get(-1) ?? []),
    ...server.flatMap((line, index) => [line, ...(slots.get(index) ?? [])]),
  ];
}

/** The terminal sends bare commands; the shortcuts and habit add a leading slash. */
export function normalizeCommand(text: string): string {
  return text.trim().replace(/^\/+/, '');
}

/** Sliding window of accepted sends, used to disable Enviar before the server-side limit hits. */
export class SendWindow {
  private stamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  record(now: number): void {
    this.prune(now);
    this.stamps.push(now);
  }

  isFull(now: number): boolean {
    this.prune(now);
    return this.stamps.length >= this.max;
  }

  /** Milliseconds until a slot frees up; 0 when not full. */
  msUntilFree(now: number): number {
    return this.isFull(now) ? this.stamps[0] + this.windowMs - now : 0;
  }

  private prune(now: number): void {
    this.stamps = this.stamps.filter((stamp) => now - stamp < this.windowMs);
  }
}

export const QUICK_COMMANDS = [
  '/save-all',
  '/time set day',
  '/weather clear',
  '/whitelist list',
  '/list',
] as const;
