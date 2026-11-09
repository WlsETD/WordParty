/** Source of server time. Inject a ManualClock in tests. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export class ManualClock implements Clock {
  constructor(private t = 1_000_000) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): number {
    this.t += ms;
    return this.t;
  }
  set(t: number): void {
    this.t = t;
  }
}
