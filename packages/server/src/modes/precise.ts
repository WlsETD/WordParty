import type { PlayerId, PreciseConfig, PreciseLane, PreciseState, SubmitResult } from '@wordparty/shared';
import type { GameMode, ModeDefinition, PlayerRoundStatus, RoundContext } from './GameMode.js';
import { ScoreBook, lastLetter } from './shared.js';

interface Lane {
  lastWord: string;
  used: Set<string>;
  count: number;
  combo: number;
  errors: number;
  out: boolean;
}

/** Combo multiplier: ×1.5 from combo 3, ×2 from combo 6. */
export function comboMultiplier(combo: number): number {
  return combo >= 6 ? 2 : combo >= 3 ? 1.5 : 1;
}

export function flameTier(combo: number): 0 | 1 | 2 | 3 {
  return combo >= 6 ? 3 : combo >= 3 ? 2 : combo >= 1 ? 1 : 0;
}

/**
 * 精準接龍 Precise.
 * Everyone builds their own chain from the same start word.
 * Valid word: + length × combo multiplier. Any rejected word: − wrongPenalty, combo resets,
 * error +1 (a Shield absorbs one). `maxErrors` errors puts you out for the round.
 */
export class PreciseMode implements GameMode<'precise'> {
  readonly id = 'precise' as const;
  private ctx!: RoundContext;
  private startWord = '';
  private deadline = 0;
  private readonly lanes = new Map<PlayerId, Lane>();
  private book!: ScoreBook;
  private readonly penalty = new Map<PlayerId, number>();

  constructor(readonly config: PreciseConfig) {}

  onStart(ctx: RoundContext): void {
    this.ctx = ctx;
    this.book = new ScoreBook(ctx.players);
    this.startWord = ctx.seedWord();
    this.deadline = ctx.now() + this.config.roundMs;
    for (const p of ctx.players) {
      this.lanes.set(p, { lastWord: this.startWord, used: new Set([this.startWord]), count: 0, combo: 0, errors: 0, out: false });
    }
  }

  private deadlineFor(p: PlayerId): number {
    return this.deadline - (this.penalty.get(p) ?? 0);
  }

  onSubmit(p: PlayerId, raw: string, now: number): SubmitResult {
    const lane = this.lanes.get(p);
    if (!lane || lane.out) return { ok: false, reason: 'ELIMINATED' };
    if (now >= this.deadlineFor(p)) return { ok: false, reason: 'ROUND_NOT_ACTIVE' };

    const v = this.ctx.validate(p, raw, { requiredStart: lastLetter(lane.lastWord), used: lane.used });
    if (!v.ok) {
      if (this.ctx.consumeShield(p)) {
        this.ctx.reject(p, v.word, v.reason, 0);
        return { ok: false, reason: v.reason, penalty: 0 };
      }
      const penalty = this.config.wrongPenalty;
      lane.combo = 0;
      lane.errors++;
      this.book.add(p, -penalty);
      this.ctx.reject(p, v.word, v.reason, penalty);
      if (lane.errors >= this.config.maxErrors) {
        lane.out = true;
        this.ctx.emit({ type: 'PLAYER_ELIMINATED', playerId: p, at: now });
      }
      return { ok: false, reason: v.reason, penalty };
    }

    lane.combo++;
    lane.count++;
    lane.used.add(v.word);
    lane.lastWord = v.word;
    const base = Math.round(v.word.length * comboMultiplier(lane.combo));
    const points = this.ctx.accept(p, v.word, base, { combo: lane.combo });
    this.book.word(p, v.word, points);
    return { ok: true, word: v.word, points };
  }

  onTick(): void {}

  applyTimePenalty(p: PlayerId, ms: number, now: number): boolean {
    const lane = this.lanes.get(p);
    if (!lane || lane.out || this.deadlineFor(p) <= now) return false;
    this.penalty.set(p, (this.penalty.get(p) ?? 0) + ms);
    return true;
  }

  personalDeadline(p: PlayerId): number | null {
    return this.penalty.has(p) ? this.deadlineFor(p) : null;
  }

  onPlayerLeft(p: PlayerId): void {
    const lane = this.lanes.get(p);
    if (lane) lane.out = true;
  }

  getPublicState(): PreciseState {
    const lanes: PreciseLane[] = [...this.lanes].map(([playerId, l]) => ({
      playerId,
      lastWord: l.lastWord,
      requiredLetter: lastLetter(l.lastWord),
      count: l.count,
      combo: l.combo,
      flameTier: flameTier(l.combo),
      errors: l.errors,
      out: l.out,
      score: this.book.points(playerId),
    }));
    return { mode: 'precise', startWord: this.startWord, deadline: this.deadline, maxErrors: this.config.maxErrors, lanes };
  }

  isRoundOver(now: number): boolean {
    if (now >= this.deadline) return true;
    return [...this.lanes.values()].every((l) => l.out);
  }

  computeScores() {
    return this.book.toRecord();
  }

  getPlayerStatus(p: PlayerId): PlayerRoundStatus {
    return { eliminated: this.lanes.get(p)?.out ?? false, lives: null, team: null };
  }
}

export const preciseMode: ModeDefinition<'precise'> = { id: 'precise', create: (c) => new PreciseMode(c) };
