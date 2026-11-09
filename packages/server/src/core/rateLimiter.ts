import type { Clock } from './clock.js';

/** Token bucket: `perSecond` tokens are refilled per second up to `burst`. */
export class RateLimiter {
  private tokens: number;
  private last: number;
  strikes = 0;

  constructor(
    private readonly clock: Clock,
    private readonly perSecond: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
    this.last = clock.now();
  }

  /** Returns false (and counts a strike) when the message should be dropped. */
  take(): boolean {
    const now = this.clock.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    this.strikes++;
    return false;
  }
}
