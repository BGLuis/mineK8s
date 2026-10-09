import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('is full after `max` sends and frees up when the oldest leaves the window', () => {
    const window = new RateLimiter(5, 1000);
    for (const at of [0, 100, 200, 300, 400]) {
      window.record(at);
    }

    expect(window.isFull(500)).toBe(true);
    expect(window.msUntilFree(500)).toBe(500);
    expect(window.isFull(1000)).toBe(false);
    expect(window.msUntilFree(1000)).toBe(0);
  });
});
