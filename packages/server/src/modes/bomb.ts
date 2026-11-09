import type { BombConfig, BombState, FuseStage, PlayerId, SubmitResult } from '@wordparty/shared';
import type { GameMode, ModeDefinition, PlayerRoundStatus, RoundContext, SubmitOptions } from './GameMode.js';
import { ScoreBook, addSurvivalBonus, lastLetter } from './shared.js';

/** Points for each successful pass (before Star ×2). */
export const BOMB_PASS_POINTS = 2;

export function fuseStageFor(fraction: number): FuseStage {
  if (fraction > 0.72) return 'idle';
  if (fraction > 0.46) return 'fuse1';
  if (fraction > 0.22) return 'fuse2';
  if (fraction > 0.06) return 'fuse3';
  return 'critical';
}

/**
 * 炸彈傳遞 Bomb Pass.
 * One shared fuse of random hidden length burns continuously across passes. The holder must
 * answer with a word starting with the last letter of the current word, then passes the bomb
 * to someone else (not the player who just passed it to them, and not themselves).
 * Every holder gets at least `minTurnMs`. When the fuse burns out the holder loses a life
 * (a Shield blocks it); after a pause a new fuse is lit. Last player alive wins.
 * Score: 2 per pass + 10 for every player outlasted.
 */
export class BombMode implements GameMode<'bomb'> {
  readonly id = 'bomb' as const;
  private ctx!: RoundContext;
  private book!: ScoreBook;
  private readonly lives = new Map<PlayerId, number>();
  private readonly eliminatedOrder: PlayerId[] = [];
  private readonly wordsPassed = new Map<PlayerId, number>();
  private readonly used = new Set<string>();
  private readonly pendingPenalty = new Map<PlayerId, number>();

  private holder: PlayerId | null = null;
  private passedFrom: PlayerId | null = null;
  private nextHolder: PlayerId | null = null;
  private currentWord = '';
  private turnStartedAt = 0;
  private fuseStartedAt = 0;
  private fuseEndsAt = 0;
  private pausedUntil: number | null = null;
  private lastThrow: BombState['lastThrow'] = null;
  private lastExplosion: BombState['lastExplosion'] = null;

  constructor(readonly config: BombConfig) {}

  onStart(ctx: RoundContext): void {
    this.ctx = ctx;
    this.book = new ScoreBook(ctx.players);
    for (const p of ctx.players) {
      this.lives.set(p, this.config.lives);
      this.wordsPassed.set(p, 0);
    }
    this.newWord();
    this.lightFuse(ctx.rng.pick(ctx.players), ctx.now());
  }

  private alive(p: PlayerId): boolean {
    return (this.lives.get(p) ?? 0) > 0;
  }

  private alivePlayers(): PlayerId[] {
    return this.ctx.players.filter((p) => this.alive(p));
  }

  private newWord(): void {
    this.currentWord = this.ctx.seedWord((w) => !this.used.has(w));
    this.used.add(this.currentWord);
  }

  private lightFuse(holder: PlayerId, now: number): void {
    this.fuseStartedAt = now;
    this.fuseEndsAt = now + this.ctx.rng.int(this.config.fuseMinMs, this.config.fuseMaxMs);
    this.passedFrom = null;
    this.give(holder, now);
  }

  /** Hands the bomb to `p`, applying any pending Hourglass and the minimum turn time. */
  private give(p: PlayerId, now: number): void {
    this.holder = p;
    this.turnStartedAt = now;
    const pending = this.pendingPenalty.get(p);
    if (pending) {
      this.fuseEndsAt -= pending;
      this.pendingPenalty.delete(p);
    }
    this.fuseEndsAt = Math.max(this.fuseEndsAt, now + this.config.minTurnMs);
  }

  /** Players the holder may pass to. The "not back to sender" rule is dropped when it leaves nobody. */
  eligibleTargets(from: PlayerId): PlayerId[] {
    const others = this.alivePlayers().filter((p) => p !== from);
    const strict = others.filter((p) => p !== this.passedFrom);
    return strict.length ? strict : others;
  }

  onSubmit(p: PlayerId, raw: string, now: number, opts: SubmitOptions): SubmitResult {
    if (!this.alive(p)) return { ok: false, reason: 'ELIMINATED' };
    if (this.pausedUntil !== null || this.holder === null) return { ok: false, reason: 'ROUND_NOT_ACTIVE' };
    if (p !== this.holder) return { ok: false, reason: 'NOT_YOUR_TURN' };
    const eligible = this.eligibleTargets(p);
    if (opts.targetId !== undefined && !eligible.includes(opts.targetId)) return { ok: false, reason: 'INVALID_TARGET' };

    const v = this.ctx.validate(p, raw, { requiredStart: lastLetter(this.currentWord), used: this.used });
    if (!v.ok) {
      this.ctx.reject(p, v.word, v.reason);
      return { ok: false, reason: v.reason };
    }
    this.used.add(v.word);
    const points = this.ctx.accept(p, v.word, BOMB_PASS_POINTS);
    this.book.word(p, v.word, points);
    this.wordsPassed.set(p, (this.wordsPassed.get(p) ?? 0) + 1);

    const target = opts.targetId ?? this.ctx.rng.pick(eligible);
    this.lastThrow = { from: p, to: target, word: v.word, at: now };
    this.ctx.emit({ type: 'BOMB_PASSED', from: p, to: target, word: v.word, at: now });
    this.currentWord = v.word;
    this.passedFrom = p;
    this.give(target, now);
    return { ok: true, word: v.word, points };
  }

  onTick(now: number): void {
    if (this.pausedUntil !== null) {
      if (now < this.pausedUntil) return;
      this.pausedUntil = null;
      let next = this.nextHolder;
      if (!next || !this.alive(next)) next = this.ctx.rng.pick(this.alivePlayers());
      this.nextHolder = null;
      this.newWord();
      this.lightFuse(next, now);
      return;
    }
    if (this.holder && now >= this.fuseEndsAt) this.explode(now);
  }

  private explode(now: number): void {
    const h = this.holder!;
    if (this.ctx.consumeShield(h)) {
      this.lastExplosion = { playerId: h, at: now, shielded: true };
      this.ctx.emit({ type: 'BOMB_EXPLODED', playerId: h, livesLeft: this.lives.get(h)!, shielded: true, at: now });
    } else {
      const left = (this.lives.get(h) ?? 1) - 1;
      this.lives.set(h, left);
      this.lastExplosion = { playerId: h, at: now, shielded: false };
      this.ctx.emit({ type: 'BOMB_EXPLODED', playerId: h, livesLeft: left, shielded: false, at: now });
      if (left <= 0) {
        this.eliminatedOrder.push(h);
        this.ctx.emit({ type: 'PLAYER_ELIMINATED', playerId: h, at: now });
      }
    }
    this.holder = null;
    this.passedFrom = null;
    if (this.alivePlayers().length <= 1) return;
    this.nextHolder = this.alive(h) ? h : this.ctx.rng.pick(this.alivePlayers());
    this.pausedUntil = now + this.config.explosionPauseMs;
  }

  applyTimePenalty(p: PlayerId, ms: number): boolean {
    if (!this.alive(p)) return false;
    if (this.holder === p && this.pausedUntil === null) {
      this.fuseEndsAt = Math.max(this.fuseEndsAt - ms, this.turnStartedAt + this.config.minTurnMs);
    } else {
      this.pendingPenalty.set(p, (this.pendingPenalty.get(p) ?? 0) + ms);
    }
    return true;
  }

  onPlayerLeft(p: PlayerId, now: number): void {
    if (!this.alive(p)) return;
    this.lives.set(p, 0);
    this.eliminatedOrder.push(p);
    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      this.holder = null;
      this.pausedUntil = null;
      return;
    }
    if (this.holder === p) {
      this.passedFrom = null;
      this.give(this.ctx.rng.pick(alive), now);
    }
    if (this.passedFrom === p) this.passedFrom = null;
    if (this.nextHolder === p) this.nextHolder = this.ctx.rng.pick(alive);
  }

  fuseFraction(now: number): number {
    if (!this.holder) return 1;
    const total = this.fuseEndsAt - this.fuseStartedAt;
    return total <= 0 ? 0 : Math.max(0, Math.min(1, (this.fuseEndsAt - now) / total));
  }

  getPublicState(now: number): BombState {
    const fraction = this.fuseFraction(now);
    return {
      mode: 'bomb',
      holderId: this.holder,
      passedFromId: this.passedFrom,
      currentWord: this.currentWord,
      requiredLetter: lastLetter(this.currentWord),
      turnStartedAt: this.turnStartedAt,
      fuseStage: fuseStageFor(fraction),
      fuseFraction: Math.round(fraction * 100) / 100,
      pausedUntil: this.pausedUntil,
      lastThrow: this.lastThrow,
      lastExplosion: this.lastExplosion,
      lives: Object.fromEntries(this.lives),
      eliminatedOrder: this.eliminatedOrder.slice(),
      wordsPassed: Object.fromEntries(this.wordsPassed),
    };
  }

  isRoundOver(): boolean {
    return this.alivePlayers().length <= 1;
  }

  computeScores() {
    const book = new ScoreBook(this.ctx.players);
    for (const [p, row] of Object.entries(this.book.toRecord())) {
      Object.assign(book.row(p), row);
    }
    addSurvivalBonus(book, this.ctx.players, this.eliminatedOrder);
    return book.toRecord();
  }

  getPlayerStatus(p: PlayerId): PlayerRoundStatus {
    const lives = this.lives.get(p) ?? 0;
    return { eliminated: lives <= 0, lives, team: null };
  }

  /** For tests. */
  get fuseEnd(): number {
    return this.fuseEndsAt;
  }
}

export const bombMode: ModeDefinition<'bomb'> = { id: 'bomb', create: (c) => new BombMode(c) };
