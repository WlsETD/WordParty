import type { PlayerId, SubmitResult, TrapChainConfig, TrapChainState, TrapRule, WordEntry } from '@wordparty/shared';
import { trapBroken } from '../dictionary/validator.js';
import type { Rng } from '../core/rng.js';
import type { GameMode, ModeDefinition, PlayerRoundStatus, RoundContext } from './GameMode.js';
import { ScoreBook, addSurvivalBonus, lastLetter, nextInOrder, tail } from './shared.js';

export const TRAP_PENALTY = 3;
const TRAP_LETTERS = 'esatrnoil'.split('');
const TRAP_END_LETTERS = 'sedtyr'.split('');
const MIN_TURN_MS = 1000;

/** Builds `count` distinct trap rules. The first is always a forbidden letter. */
export function generateTraps(rng: Rng, count: number, banned: readonly string[], minLength: number): TrapRule[] {
  const rules: TrapRule[] = [];
  /** Letters already used by any rule, so no two rules share a letter. */
  const taken = () => new Set(rules.flatMap((r) => ('letter' in r ? [r.letter] : [])));
  const free = (pool: string[]) => pool.filter((l) => !banned.includes(l) && !taken().has(l));
  rules.push({ kind: 'NO_LETTER', letter: rng.pick(free(TRAP_LETTERS)) });
  for (const kind of rng.shuffle(['NO_LETTER', 'NO_END_LETTER', 'MAX_LENGTH'] as const)) {
    if (rules.length >= count) break;
    if (kind === 'MAX_LENGTH') rules.push({ kind, length: Math.max(minLength + 2, rng.int(5, 7)) });
    else rules.push({ kind, letter: rng.pick(free(kind === 'NO_LETTER' ? TRAP_LETTERS : TRAP_END_LETTERS)) });
  }
  return rules;
}

/**
 * 陷阱接龍 Trap Chain.
 * Turn-based single chain with 1–3 visible trap rules (e.g. no E, no word ending in S, max 6
 * letters). A word that breaks a trap costs a life and 3 points and passes the turn; other
 * invalid words can simply be retried. A timeout also costs a life. A Shield absorbs one life
 * loss. Last player standing (or the most lives when time runs out) does best.
 * Score: word length per word − 3 per trap + 10 for every player outlasted.
 */
export class TrapChainMode implements GameMode<'trapChain'> {
  readonly id = 'trapChain' as const;
  private ctx!: RoundContext;
  private book!: ScoreBook;
  private traps: TrapRule[] = [];
  private readonly lives = new Map<PlayerId, number>();
  private readonly eliminatedOrder: PlayerId[] = [];
  private readonly history: WordEntry[] = [];
  private readonly used = new Set<string>();
  private readonly pendingPenalty = new Map<PlayerId, number>();
  private currentWord = '';
  private active: PlayerId | null = null;
  private turnDeadline = 0;
  private deadline = 0;

  constructor(readonly config: TrapChainConfig) {}

  onStart(ctx: RoundContext): void {
    this.ctx = ctx;
    this.book = new ScoreBook(ctx.players);
    for (const p of ctx.players) this.lives.set(p, this.config.lives);
    this.traps = generateTraps(ctx.rng, this.config.trapCount, ctx.modifiers.bannedLetters, ctx.modifiers.minLength);
    this.currentWord = ctx.seedWord((w) => !this.traps.some((t) => trapBroken(w, t)));
    this.used.add(this.currentWord);
    const now = ctx.now();
    this.deadline = now + this.config.roundMs;
    this.startTurn(ctx.rng.pick(ctx.players), now);
  }

  private alive(p: PlayerId): boolean {
    return (this.lives.get(p) ?? 0) > 0;
  }

  private aliveCount(): number {
    return this.ctx.players.filter((p) => this.alive(p)).length;
  }

  private startTurn(p: PlayerId | null, now: number): void {
    this.active = p;
    if (!p) return;
    const pending = this.pendingPenalty.get(p) ?? 0;
    this.pendingPenalty.delete(p);
    this.turnDeadline = now + Math.max(MIN_TURN_MS, this.config.turnMs - pending);
  }

  private passTurn(now: number): void {
    if (this.aliveCount() <= 1) {
      this.active = null;
      return;
    }
    this.startTurn(nextInOrder(this.ctx.players, this.active, (x) => this.alive(x)), now);
  }

  /** Costs `p` a life unless shielded. Returns lives left. */
  private loseLife(p: PlayerId, now: number): number {
    if (this.ctx.consumeShield(p)) return this.lives.get(p)!;
    const left = (this.lives.get(p) ?? 1) - 1;
    this.lives.set(p, left);
    if (left <= 0) {
      this.eliminatedOrder.push(p);
      this.ctx.emit({ type: 'PLAYER_ELIMINATED', playerId: p, at: now });
    }
    return left;
  }

  onSubmit(p: PlayerId, raw: string, now: number): SubmitResult {
    if (!this.alive(p)) return { ok: false, reason: 'ELIMINATED' };
    if (now >= this.deadline || !this.active) return { ok: false, reason: 'ROUND_NOT_ACTIVE' };
    if (p !== this.active) return { ok: false, reason: 'NOT_YOUR_TURN' };
    const v = this.ctx.validate(p, raw, { requiredStart: lastLetter(this.currentWord), used: this.used, traps: this.traps });
    if (!v.ok) {
      if (v.reason !== 'TRAP_HIT') {
        this.ctx.reject(p, v.word, v.reason);
        return { ok: false, reason: v.reason };
      }
      this.book.add(p, -TRAP_PENALTY);
      this.ctx.reject(p, v.word, v.reason, TRAP_PENALTY);
      const livesLeft = this.loseLife(p, now);
      this.ctx.emit({ type: 'TRAP_HIT', playerId: p, word: v.word, rule: v.trap!, livesLeft, at: now });
      this.passTurn(now);
      return { ok: false, reason: 'TRAP_HIT', penalty: TRAP_PENALTY };
    }
    this.used.add(v.word);
    const points = this.ctx.accept(p, v.word, v.word.length);
    this.book.word(p, v.word, points);
    this.history.push({ word: v.word, playerId: p, points, at: now });
    this.currentWord = v.word;
    this.passTurn(now);
    return { ok: true, word: v.word, points };
  }

  onTick(now: number): void {
    if (!this.active || now >= this.deadline || now < this.turnDeadline) return;
    const p = this.active;
    const livesLeft = this.loseLife(p, now);
    this.ctx.emit({ type: 'TURN_TIMEOUT', playerId: p, livesLeft, at: now });
    this.passTurn(now);
  }

  applyTimePenalty(p: PlayerId, ms: number, now: number): boolean {
    if (!this.alive(p) || now >= this.deadline) return false;
    if (p === this.active) this.turnDeadline = Math.max(now + MIN_TURN_MS, this.turnDeadline - ms);
    else this.pendingPenalty.set(p, (this.pendingPenalty.get(p) ?? 0) + ms);
    return true;
  }

  onPlayerLeft(p: PlayerId, now: number): void {
    if (!this.alive(p)) return;
    const wasActive = this.active === p;
    this.lives.set(p, 0);
    this.eliminatedOrder.push(p);
    if (wasActive) this.passTurn(now);
    else if (this.aliveCount() <= 1) this.active = null;
  }

  getPublicState(): TrapChainState {
    return {
      mode: 'trapChain',
      currentWord: this.currentWord,
      requiredLetter: lastLetter(this.currentWord),
      activePlayerId: this.active,
      turnDeadline: this.turnDeadline,
      deadline: this.deadline,
      traps: this.traps.map((t) => ({ ...t })),
      history: tail(this.history),
      lives: Object.fromEntries(this.lives),
      eliminatedOrder: this.eliminatedOrder.slice(),
    };
  }

  isRoundOver(now: number): boolean {
    return now >= this.deadline || this.aliveCount() <= 1;
  }

  computeScores() {
    const book = new ScoreBook(this.ctx.players);
    for (const [p, row] of Object.entries(this.book.toRecord())) Object.assign(book.row(p), row);
    addSurvivalBonus(book, this.ctx.players, this.eliminatedOrder);
    return book.toRecord();
  }

  getPlayerStatus(p: PlayerId): PlayerRoundStatus {
    const lives = this.lives.get(p) ?? 0;
    return { eliminated: lives <= 0, lives, team: null };
  }
}

export const trapChainMode: ModeDefinition<'trapChain'> = { id: 'trapChain', create: (c) => new TrapChainMode(c) };
