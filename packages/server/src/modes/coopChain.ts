import type { CoopChainConfig, CoopChainState, PlayerId, SubmitResult, WordEntry } from '@wordparty/shared';
import type { GameMode, ModeDefinition, PlayerRoundStatus, RoundContext } from './GameMode.js';
import { ScoreBook, lastLetter, tail } from './shared.js';

export const COOP_WORD_POINTS = 3;
export const COOP_MILESTONE_BONUS = 5;
export const COOP_COMPLETE_BONUS = 20;

/**
 * 合作長龍 Co-op Long Chain.
 * Everyone builds one chain together toward `target` words before time runs out. Anyone may
 * answer, but nobody may add two words in a row.
 * Score: 3 per own word; everyone gets +5 per milestone reached (1/3, 2/3) and +20 if completed.
 */
export class CoopChainMode implements GameMode<'coopChain'> {
  readonly id = 'coopChain' as const;
  private ctx!: RoundContext;
  private book!: ScoreBook;
  private readonly chain: WordEntry[] = [];
  private readonly used = new Set<string>();
  private readonly contributions = new Map<PlayerId, number>();
  private currentWord = '';
  private lastPlayerId: PlayerId | null = null;
  private deadline = 0;
  private milestones: number[] = [];
  private milestonesReached = 0;
  private completed = false;

  constructor(readonly config: CoopChainConfig) {}

  onStart(ctx: RoundContext): void {
    this.ctx = ctx;
    this.book = new ScoreBook(ctx.players);
    for (const p of ctx.players) this.contributions.set(p, 0);
    const t = this.config.target;
    this.milestones = [...new Set([Math.ceil(t / 3), Math.ceil((2 * t) / 3)])].filter((m) => m > 0 && m < t);
    this.currentWord = ctx.seedWord();
    this.used.add(this.currentWord);
    this.deadline = ctx.now() + this.config.roundMs;
  }

  onSubmit(p: PlayerId, raw: string, now: number): SubmitResult {
    if (!this.contributions.has(p)) return { ok: false, reason: 'ELIMINATED' };
    if (this.completed || now >= this.deadline) return { ok: false, reason: 'ROUND_NOT_ACTIVE' };
    if (p === this.lastPlayerId && this.contributions.size > 1) return { ok: false, reason: 'NOT_YOUR_TURN' };
    const v = this.ctx.validate(p, raw, { requiredStart: lastLetter(this.currentWord), used: this.used });
    if (!v.ok) {
      this.ctx.reject(p, v.word, v.reason);
      return { ok: false, reason: v.reason };
    }
    this.used.add(v.word);
    const points = this.ctx.accept(p, v.word, COOP_WORD_POINTS);
    this.book.word(p, v.word, points);
    this.chain.push({ word: v.word, playerId: p, points, at: now });
    this.contributions.set(p, (this.contributions.get(p) ?? 0) + 1);
    this.currentWord = v.word;
    this.lastPlayerId = p;

    const count = this.chain.length;
    const mi = this.milestones.indexOf(count);
    if (mi >= 0) {
      this.milestonesReached++;
      this.ctx.emit({ type: 'MILESTONE', index: mi, count, at: now });
    }
    if (count >= this.config.target) {
      this.completed = true;
      this.ctx.emit({ type: 'CHAIN_COMPLETE', at: now });
    }
    return { ok: true, word: v.word, points };
  }

  onTick(): void {}

  onPlayerLeft(p: PlayerId): void {
    this.contributions.delete(p);
    if (this.lastPlayerId === p) this.lastPlayerId = null;
  }

  getPublicState(): CoopChainState {
    return {
      mode: 'coopChain',
      chain: tail(this.chain),
      count: this.chain.length,
      target: this.config.target,
      milestones: this.milestones.slice(),
      currentWord: this.currentWord,
      requiredLetter: lastLetter(this.currentWord),
      lastPlayerId: this.lastPlayerId,
      contributions: Object.fromEntries(this.contributions),
      deadline: this.deadline,
      completed: this.completed,
    };
  }

  isRoundOver(now: number): boolean {
    return this.completed || now >= this.deadline;
  }

  computeScores() {
    const bonus = this.milestonesReached * COOP_MILESTONE_BONUS + (this.completed ? COOP_COMPLETE_BONUS : 0);
    const book = new ScoreBook(this.ctx.players);
    for (const [p, row] of Object.entries(this.book.toRecord())) Object.assign(book.row(p), row);
    for (const p of this.contributions.keys()) book.add(p, bonus);
    return book.toRecord();
  }

  getPlayerStatus(): PlayerRoundStatus {
    return { eliminated: false, lives: null, team: null };
  }
}

export const coopChainMode: ModeDefinition<'coopChain'> = { id: 'coopChain', create: (c) => new CoopChainMode(c) };
