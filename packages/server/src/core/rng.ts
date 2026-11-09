/** Random source. Seeded in tests so games are reproducible. */
export interface Rng {
  /** [0, 1) */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
}

class BaseRng implements Rng {
  constructor(private readonly source: () => number) {}
  next(): number {
    return this.source();
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.source() * (max - min + 1));
  }
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from empty list');
    return items[Math.floor(this.source() * items.length)];
  }
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.source() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

/** mulberry32 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return new BaseRng(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

export const mathRng: Rng = new BaseRng(Math.random);
