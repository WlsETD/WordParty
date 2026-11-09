import { readFileSync } from 'node:fs';
import type { Rng } from '../core/rng.js';

/** Start letters that have plenty of words, used for random prompts. */
export const COMMON_START_LETTERS = 'abcdefghilmnoprstw'.split('');

export class Dictionary {
  private readonly words = new Set<string>();
  private readonly byFirst = new Map<string, string[]>();
  /** Medium-length words that end in a common start letter; good chain seeds. */
  private readonly seeds: string[] = [];

  constructor(words: Iterable<string>) {
    for (const raw of words) {
      const w = raw.trim().toLowerCase();
      if (!/^[a-z]+$/.test(w) || this.words.has(w)) continue;
      this.words.add(w);
      const first = w[0];
      let list = this.byFirst.get(first);
      if (!list) this.byFirst.set(first, (list = []));
      list.push(w);
      if (w.length >= 4 && w.length <= 7 && COMMON_START_LETTERS.includes(w[w.length - 1])) this.seeds.push(w);
    }
  }

  /** Loads a newline-separated word list such as ENABLE (enable1.txt). */
  static fromFile(path: string): Dictionary {
    return new Dictionary(readFileSync(path, 'utf8').split(/\r?\n/));
  }

  get size(): number {
    return this.words.size;
  }

  has(word: string): boolean {
    return this.words.has(word);
  }

  /** All words that start with `letter`. */
  wordsStartingWith(letter: string): readonly string[] {
    return this.byFirst.get(letter) ?? [];
  }

  randomStartLetter(rng: Rng, exclude: Iterable<string> = []): string {
    const ex = new Set(exclude);
    const options = COMMON_START_LETTERS.filter((l) => !ex.has(l) && (this.byFirst.get(l)?.length ?? 0) > 0);
    return rng.pick(options.length ? options : COMMON_START_LETTERS);
  }

  /** A random seed word for a chain. `accept` filters candidates. */
  randomSeedWord(rng: Rng, accept: (w: string) => boolean = () => true): string {
    const pool = this.seeds.length ? this.seeds : [...this.words];
    for (let i = 0; i < 500; i++) {
      const w = rng.pick(pool);
      if (accept(w)) return w;
    }
    const fallback = pool.find(accept);
    if (!fallback) throw new Error('no seed word matches');
    return fallback;
  }
}
