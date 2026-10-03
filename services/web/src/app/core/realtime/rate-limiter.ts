/** Sliding-window limiter: at most `max` acquisitions in any `windowMs` interval. */
export class RateLimiter {
  private readonly stamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  tryAcquire(now: number = Date.now()): boolean {
    while (this.stamps.length > 0 && now - this.stamps[0] >= this.windowMs) {
      this.stamps.shift();
    }
    if (this.stamps.length >= this.max) {
      return false;
    }
    this.stamps.push(now);
    return true;
  }
}
