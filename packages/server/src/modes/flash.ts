import type { FlashConfig, FlashState, PlayerId, SubmitResult, WordEntry } from '@wordparty/shared';
import type { GameMode, ModeDefinition, PlayerRoundStatus, RoundContext } from './GameMode.js';
import { ScoreBook, entry } from './shared.js';

/**
 * 閃電搶答 Flash.
 * Everyone gets the same start letter. Each word can be scored only once in the whole room:
 * the first submission the server processes wins, later ones get ALREADY_USED.
 * Points = word length.
 */
export class FlashMode implements GameMode<'flash'> {
  readonly id = 'flash' as const;
  private ctx!: RoundContext;
  private startLetter = 'a';
  private deadline = 0;
  private readonly grabbed: WordEntry[] = [];
  private readonly used = new Set<string>();
  private book!: ScoreBook;
  private readonly penalty = new Map<PlayerId, number>();

  constructor(readonly config: FlashConfig) {}

  onStart(ctx: RoundContext): void {
    this.ctx = ctx;
    this.book = new ScoreBook(ctx.players);
    this.startLetter = ctx.startLetter();
    this.deadline = ctx.now() + this.config.roundMs;
  }

  private deadlineFor(p: PlayerId): number {
    return this.deadline - (this.penalty.get(p) ?? 0);
  }

  onSubmit(p: PlayerId, raw: string, now: number): SubmitResult {
    if (!this.ctx.players.includes(p)) return { ok: false, reason: 'ELIMINATED' };
    if (now >= this.deadlineFor(p)) return { ok: false, reason: 'ROUND_NOT_ACTIVE' };
    const v = this.ctx.validate(p, raw, { requiredStart: this.startLetter, used: this.used });
    if (!v.ok) {
      this.ctx.reject(p, v.word, v.reason);
      return { ok: false, reason: v.reason };
    }
    this.used.add(v.word);
    const points = this.ctx.accept(p, v.word, v.word.length);
    this.book.word(p, v.word, points);
    this.grabbed.push(entry(v.word, p, points, now));
    return { ok: true, word: v.word, points };
  }

  onTick(): void {}

  applyTimePenalty(p: PlayerId, ms: number, now: number): boolean {
    if (this.deadlineFor(p) <= now) return false;
    this.penalty.set(p, (this.penalty.get(p) ?? 0) + ms);
    return true;
  }

  personalDeadline(p: PlayerId): number | null {
    return this.penalty.has(p) ? this.deadlineFor(p) : null;
  }

  getPublicState(): FlashState {
    return {
      mode: 'flash',
      startLetter: this.startLetter,
      deadline: this.deadline,
      grabbed: this.grabbed.slice(),
      scores: this.book.pointsMap(),
    };
  }

  isRoundOver(now: number): boolean {
    return now >= this.deadline;
  }

  computeScores() {
    return this.book.toRecord();
  }

  getPlayerStatus(): PlayerRoundStatus {
    return { eliminated: false, lives: null, team: null };
  }
}

export const flashMode: ModeDefinition<'flash'> = { id: 'flash', create: (c) => new FlashMode(c) };
