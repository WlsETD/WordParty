import type { LastStandConfig, LastStandState, PlayerId, SubmitResult } from '@wordparty/shared';
import type { GameMode, ModeDefinition, PlayerRoundStatus, RoundContext } from './GameMode.js';
import { ScoreBook, addSurvivalBonus } from './shared.js';

/**
 * 末位淘汰 Last-place Elimination.
 * The round is a series of short heats. In each heat every living player answers on their own
 * with words starting with the heat's letter (players do not compete for words). Heat score =
 * total letters. At the end of each heat the lowest scorer is eliminated; on a tie, the one whose
 * last valid word came later (or who never scored) goes; a full tie is broken at random.
 * A Shield saves its owner once, and the next-lowest player is eliminated instead.
 * Score: total letters + 10 for every player outlasted.
 */
export class LastStandMode implements GameMode<'lastStand'> {
  readonly id = 'lastStand' as const;
  private ctx!: RoundContext;
  private book!: ScoreBook;
  private readonly alive = new Set<PlayerId>();
  private readonly eliminatedOrder: PlayerId[] = [];
  private heat = 0;
  private startLetter = 'a';
  private readonly usedLetters: string[] = [];
  private heatDeadline: number | null = null;
  private nextHeatAt: number | null = null;
  private heatScores = new Map<PlayerId, number>();
  private heatUsed = new Map<PlayerId, Set<string>>();
  private lastValidAt = new Map<PlayerId, number>();
  private penalty = new Map<PlayerId, number>();
  private lastEliminatedId: PlayerId | null = null;

  constructor(readonly config: LastStandConfig) {}

  onStart(ctx: RoundContext): void {
    this.ctx = ctx;
    this.book = new ScoreBook(ctx.players);
    for (const p of ctx.players) this.alive.add(p);
    this.startHeat(ctx.now());
  }

  private startHeat(now: number): void {
    this.heat++;
    // Avoid repeating letters until they run out.
    const letter = this.ctx.startLetter(this.usedLetters);
    if (this.usedLetters.includes(letter)) this.usedLetters.length = 0;
    this.usedLetters.push(letter);
    this.startLetter = letter;
    this.heatDeadline = now + this.config.heatMs;
    this.nextHeatAt = null;
    this.heatScores = new Map([...this.alive].map((p) => [p, 0]));
    this.heatUsed = new Map([...this.alive].map((p) => [p, new Set<string>()]));
    this.lastValidAt = new Map();
    this.penalty = new Map();
  }

  private deadlineFor(p: PlayerId): number {
    return (this.heatDeadline ?? 0) - (this.penalty.get(p) ?? 0);
  }

  onSubmit(p: PlayerId, raw: string, now: number): SubmitResult {
    if (!this.alive.has(p)) return { ok: false, reason: 'ELIMINATED' };
    if (this.heatDeadline === null || now >= this.deadlineFor(p)) return { ok: false, reason: 'ROUND_NOT_ACTIVE' };
    const used = this.heatUsed.get(p)!;
    const v = this.ctx.validate(p, raw, { requiredStart: this.startLetter, used });
    if (!v.ok) {
      this.ctx.reject(p, v.word, v.reason);
      return { ok: false, reason: v.reason };
    }
    used.add(v.word);
    const points = this.ctx.accept(p, v.word, v.word.length);
    this.book.word(p, v.word, points);
    this.heatScores.set(p, (this.heatScores.get(p) ?? 0) + points);
    this.lastValidAt.set(p, now);
    return { ok: true, word: v.word, points };
  }

  /** Living players ordered from most to least endangered (deterministic). */
  private dangerOrder(candidates: Iterable<PlayerId>): PlayerId[] {
    return [...candidates].sort((a, b) => {
      const d = (this.heatScores.get(a) ?? 0) - (this.heatScores.get(b) ?? 0);
      if (d) return d;
      return (this.lastValidAt.get(b) ?? Infinity) - (this.lastValidAt.get(a) ?? Infinity) || 0;
    });
  }

  /** Picks who is eliminated among `candidates`, breaking full ties at random. */
  private pickLoser(candidates: PlayerId[]): PlayerId {
    const order = this.dangerOrder(candidates);
    const worst = order[0];
    const key = (p: PlayerId) => `${this.heatScores.get(p) ?? 0}|${this.lastValidAt.get(p) ?? 'none'}`;
    const tied = order.filter((p) => key(p) === key(worst));
    return tied.length > 1 ? this.ctx.rng.pick(tied) : worst;
  }

  onTick(now: number): void {
    if (this.heatDeadline !== null && now >= this.heatDeadline) this.endHeat(now);
    else if (this.nextHeatAt !== null && now >= this.nextHeatAt) this.startHeat(now);
  }

  private endHeat(now: number): void {
    this.heatDeadline = null;
    let candidates = [...this.alive];
    let loser: PlayerId | null = null;
    while (candidates.length > 0) {
      const pick = this.pickLoser(candidates);
      if (this.ctx.consumeShield(pick)) {
        candidates = candidates.filter((p) => p !== pick);
        continue;
      }
      loser = pick;
      break;
    }
    if (loser) {
      this.alive.delete(loser);
      this.eliminatedOrder.push(loser);
      this.ctx.emit({ type: 'PLAYER_ELIMINATED', playerId: loser, at: now });
    }
    this.lastEliminatedId = loser;
    this.ctx.emit({ type: 'HEAT_END', heat: this.heat, eliminatedId: loser, at: now });
    if (this.alive.size > 1) this.nextHeatAt = now + this.config.heatGapMs;
  }

  applyTimePenalty(p: PlayerId, ms: number, now: number): boolean {
    if (!this.alive.has(p) || this.heatDeadline === null || this.deadlineFor(p) <= now) return false;
    this.penalty.set(p, (this.penalty.get(p) ?? 0) + ms);
    return true;
  }

  personalDeadline(p: PlayerId): number | null {
    return this.penalty.has(p) && this.heatDeadline !== null ? this.deadlineFor(p) : null;
  }

  onPlayerLeft(p: PlayerId, now: number): void {
    if (!this.alive.delete(p)) return;
    this.eliminatedOrder.push(p);
    this.ctx.emit({ type: 'PLAYER_ELIMINATED', playerId: p, at: now });
  }

  getPublicState(): LastStandState {
    return {
      mode: 'lastStand',
      heat: this.heat,
      startLetter: this.startLetter,
      heatDeadline: this.heatDeadline,
      nextHeatAt: this.nextHeatAt,
      heatScores: Object.fromEntries(this.heatScores),
      totals: this.book.pointsMap(),
      dangerId: this.heatDeadline !== null && this.alive.size > 1 ? this.dangerOrder(this.alive)[0] : null,
      alive: this.ctx.players.filter((p) => this.alive.has(p)),
      eliminatedOrder: this.eliminatedOrder.slice(),
      lastEliminatedId: this.lastEliminatedId,
    };
  }

  isRoundOver(): boolean {
    return this.alive.size <= 1;
  }

  computeScores() {
    const book = new ScoreBook(this.ctx.players);
    for (const [p, row] of Object.entries(this.book.toRecord())) Object.assign(book.row(p), row);
    addSurvivalBonus(book, this.ctx.players, this.eliminatedOrder);
    return book.toRecord();
  }

  getPlayerStatus(p: PlayerId): PlayerRoundStatus {
    return { eliminated: !this.alive.has(p), lives: null, team: null };
  }
}

export const lastStandMode: ModeDefinition<'lastStand'> = { id: 'lastStand', create: (c) => new LastStandMode(c) };
