import { fileURLToPath } from 'node:url';
import type { GameEvent, GameSetupInput, ModePublicState, PlayerId, TrapRule } from '@wordparty/shared';
import { ManualClock } from '../src/core/clock.js';
import { seededRng } from '../src/core/rng.js';
import { Dictionary } from '../src/dictionary/Dictionary.js';
import { trapBroken } from '../src/dictionary/validator.js';
import { GameEngine } from '../src/game/GameEngine.js';

export const ENABLE_PATH = fileURLToPath(new URL('../data/enable1.txt', import.meta.url));

let cached: Dictionary | null = null;
/** The real ENABLE dictionary, loaded once per test file. */
export function enable(): Dictionary {
  return (cached ??= Dictionary.fromFile(ENABLE_PATH));
}

export interface FindOptions {
  used?: Iterable<string>;
  minLength?: number;
  maxLength?: number;
  avoid?: string[];
  traps?: readonly TrapRule[];
  /** Prefer words that end in a common letter so chains continue. */
  chainable?: boolean;
}

/** Finds a dictionary word starting with `letter` that satisfies the options. */
export function findWord(dict: Dictionary, letter: string, opts: FindOptions = {}): string {
  const used = new Set(opts.used ?? []);
  const min = opts.minLength ?? 3;
  const max = opts.maxLength ?? 8;
  for (const w of dict.wordsStartingWith(letter)) {
    if (w.length < min || w.length > max || used.has(w)) continue;
    if (opts.avoid?.some((l) => w.includes(l))) continue;
    if (opts.traps?.some((t) => trapBroken(w, t))) continue;
    if (opts.chainable !== false && !'abcdefghilmnoprstw'.includes(w[w.length - 1])) continue;
    return w;
  }
  throw new Error(`no word for ${letter}`);
}

/** Drives a GameEngine with a manual clock. */
export class EngineHarness {
  readonly clock = new ManualClock();
  readonly events: GameEvent[] = [];
  readonly connected = new Set<PlayerId>();
  readonly engine: GameEngine;
  readonly dict: Dictionary;

  constructor(
    readonly players: PlayerId[] = ['A', 'B', 'C'],
    seed = 42,
  ) {
    this.dict = enable();
    for (const p of players) this.connected.add(p);
    this.engine = new GameEngine(
      { clock: this.clock, rng: seededRng(seed), dict: this.dict, countdownMs: 1000, roundEndMs: 1000, unsafeConfig: true },
      { emit: (e) => this.events.push(e), isConnected: (p) => this.connected.has(p) },
    );
  }

  get now(): number {
    return this.clock.now();
  }

  /** Configures, starts and skips the countdown so a round is running. */
  startGame(setup: GameSetupInput): this {
    const c = this.engine.configure(setup);
    if (!c.ok) throw new Error(`configure failed: ${c.error}`);
    const s = this.engine.start(this.players, this.now);
    if (!s.ok) throw new Error(`start failed: ${s.error}`);
    this.advance(1000);
    if (this.engine.phase !== 'ROUND') throw new Error(`expected ROUND, got ${this.engine.phase}`);
    return this;
  }

  /** Advances time in tick-sized steps. */
  advance(ms: number, step = 100): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.clock.advance(Math.min(step, end - this.now));
      this.engine.tick(this.now);
    }
  }

  state<M extends ModePublicState['mode']>(mode: M): Extract<ModePublicState, { mode: M }> {
    const s = this.engine.modeState(this.now);
    if (!s || s.mode !== mode) throw new Error(`no ${mode} state`);
    return s as Extract<ModePublicState, { mode: M }>;
  }

  submit(p: PlayerId, word: string, targetId?: PlayerId) {
    return this.engine.submit(p, word, { targetId }, this.now);
  }

  eventsOf<T extends GameEvent['type']>(type: T): Extract<GameEvent, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
  }

  /** Runs until the round ends, returns the round result. */
  finishRound(maxMs = 600_000) {
    const end = this.now + maxMs;
    while (this.engine.phase === 'ROUND' && this.now < end) this.advance(100);
    if (this.engine.phase !== 'ROUND_END' && this.engine.phase !== 'FINAL') throw new Error('round did not end');
    return this.engine.lastRound!;
  }
}
