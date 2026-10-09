/** Sliding-window limiter: at most `max` acquisitions in any `windowMs` interval. */
export class RateLimiter {
  private stamps: number[] = [];

  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {}

  private prune(now: number): void {
    while (this.stamps.length > 0 && now - this.stamps[0] >= this.windowMs) {
      this.stamps.shift();
    }
  }

  isFull(now: number = Date.now()): boolean {
    this.prune(now);
    return this.stamps.length >= this.max;
  }

  /** Milliseconds until a slot frees up; 0 when not full. */
  msUntilFree(now: number = Date.now()): number {
    return this.isFull(now) ? this.stamps[0] + this.windowMs - now : 0;
  }

  tryAcquire(now: number = Date.now()): boolean {
    this.prune(now);
    if (this.stamps.length >= this.max) {
      return false;
    }
    this.stamps.push(now);
    return true;
  }

  /** Record an acquisition into the window. */
  record(now: number = Date.now()): void {
    this.prune(now);
    this.stamps.push(now);
  }

  reset(): void {
    this.stamps = [];
  }
}
