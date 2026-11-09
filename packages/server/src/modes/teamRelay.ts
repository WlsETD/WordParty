import type { PlayerId, SubmitResult, TeamId, TeamRelayConfig, TeamRelayState, WordEntry } from '@wordparty/shared';
import type { GameMode, ModeDefinition, PlayerRoundStatus, RoundContext } from './GameMode.js';
import { ScoreBook, lastLetter, tail } from './shared.js';

/** Points per accepted word (to the player) and the bonus for each member of the winning team. */
export const RELAY_WORD_POINTS = 5;
export const RELAY_WIN_BONUS = 20;
const MIN_TURN_MS = 1000;

const other = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');

/**
 * 組隊接力 Team Relay.
 * Players are split into teams A and B. The teams take turns on one shared chain; inside a team
 * members rotate. A valid word gives the team +1 and passes the turn to the other team. A timeout
 * passes the turn without a point (a Shield buys one extra turn length). First team to
 * `targetScore` wins; otherwise the higher score when time runs out.
 * Score: 5 per word + 20 for each member of the winning team.
 */
export class TeamRelayMode implements GameMode<'teamRelay'> {
  readonly id = 'teamRelay' as const;
  private ctx!: RoundContext;
  private book!: ScoreBook;
  private readonly members: Record<TeamId, PlayerId[]> = { A: [], B: [] };
  private readonly pointer: Record<TeamId, number> = { A: -1, B: -1 };
  private readonly score: Record<TeamId, number> = { A: 0, B: 0 };
  private readonly teamOf = new Map<PlayerId, TeamId>();
  private readonly chain: (WordEntry & { team: TeamId })[] = [];
  private readonly used = new Set<string>();
  private readonly pendingPenalty = new Map<PlayerId, number>();
  private currentWord = '';
  private activeTeam: TeamId = 'A';
  private active: PlayerId | null = null;
  private turnDeadline = 0;
  private shieldUsedThisTurn = false;
  private deadline = 0;
  private winner: TeamId | 'DRAW' | null = null;

  constructor(readonly config: TeamRelayConfig) {}

  onStart(ctx: RoundContext): void {
    this.ctx = ctx;
    this.book = new ScoreBook(ctx.players);
    ctx.rng.shuffle(ctx.players).forEach((p, i) => {
      const team: TeamId = i % 2 === 0 ? 'A' : 'B';
      this.members[team].push(p);
      this.teamOf.set(p, team);
    });
    this.currentWord = ctx.seedWord();
    this.used.add(this.currentWord);
    const now = ctx.now();
    this.deadline = now + this.config.roundMs;
    this.startTurn(ctx.rng.pick<TeamId>(['A', 'B']), now);
  }

  /** Next member of `team` in rotation, preferring connected players. */
  private nextMember(team: TeamId): PlayerId | null {
    const list = this.members[team];
    if (!list.length) return null;
    for (let i = 1; i <= list.length; i++) {
      const idx = (this.pointer[team] + i) % list.length;
      if (this.ctx.isConnected(list[idx])) {
        this.pointer[team] = idx;
        return list[idx];
      }
    }
    this.pointer[team] = (this.pointer[team] + 1) % list.length;
    return list[this.pointer[team]];
  }

  private startTurn(team: TeamId, now: number): void {
    if (!this.members[team].length) team = other(team);
    this.activeTeam = team;
    this.active = this.nextMember(team);
    this.shieldUsedThisTurn = false;
    const pending = this.active ? (this.pendingPenalty.get(this.active) ?? 0) : 0;
    if (this.active) this.pendingPenalty.delete(this.active);
    this.turnDeadline = now + Math.max(MIN_TURN_MS, this.config.turnMs - pending);
  }

  onSubmit(p: PlayerId, raw: string, now: number): SubmitResult {
    if (!this.teamOf.has(p)) return { ok: false, reason: 'ELIMINATED' };
    if (this.winner || now >= this.deadline) return { ok: false, reason: 'ROUND_NOT_ACTIVE' };
    if (p !== this.active) return { ok: false, reason: 'NOT_YOUR_TURN' };
    const v = this.ctx.validate(p, raw, { requiredStart: lastLetter(this.currentWord), used: this.used });
    if (!v.ok) {
      this.ctx.reject(p, v.word, v.reason);
      return { ok: false, reason: v.reason };
    }
    const team = this.teamOf.get(p)!;
    this.used.add(v.word);
    this.score[team]++;
    const points = this.ctx.accept(p, v.word, RELAY_WORD_POINTS);
    this.book.word(p, v.word, points);
    this.chain.push({ word: v.word, playerId: p, points, at: now, team });
    this.currentWord = v.word;
    if (this.score[team] >= this.config.targetScore) {
      this.winner = team;
      this.active = null;
      this.ctx.emit({ type: 'TEAM_WIN', team, at: now });
    } else {
      this.startTurn(other(team), now);
    }
    return { ok: true, word: v.word, points };
  }

  onTick(now: number): void {
    if (this.winner) return;
    if (now >= this.deadline) {
      this.winner = this.score.A === this.score.B ? 'DRAW' : this.score.A > this.score.B ? 'A' : 'B';
      this.active = null;
      if (this.winner !== 'DRAW') this.ctx.emit({ type: 'TEAM_WIN', team: this.winner, at: now });
      return;
    }
    if (now < this.turnDeadline || !this.active) return;
    if (!this.shieldUsedThisTurn && this.ctx.consumeShield(this.active)) {
      this.shieldUsedThisTurn = true;
      this.turnDeadline = now + this.config.turnMs;
      return;
    }
    this.ctx.emit({ type: 'TURN_TIMEOUT', playerId: this.active, at: now });
    this.startTurn(other(this.activeTeam), now);
  }

  applyTimePenalty(p: PlayerId, ms: number, now: number): boolean {
    if (!this.teamOf.has(p) || this.winner) return false;
    if (p === this.active) this.turnDeadline = Math.max(now + MIN_TURN_MS, this.turnDeadline - ms);
    else this.pendingPenalty.set(p, (this.pendingPenalty.get(p) ?? 0) + ms);
    return true;
  }

  onPlayerLeft(p: PlayerId, now: number): void {
    const team = this.teamOf.get(p);
    if (!team) return;
    this.teamOf.delete(p);
    const list = this.members[team];
    const idx = list.indexOf(p);
    list.splice(idx, 1);
    if (idx <= this.pointer[team]) this.pointer[team]--;
    if (!this.winner && (!this.members.A.length || !this.members.B.length)) {
      this.winner = this.members.A.length ? 'A' : this.members.B.length ? 'B' : 'DRAW';
      this.active = null;
      if (this.winner !== 'DRAW') this.ctx.emit({ type: 'TEAM_WIN', team: this.winner, at: now });
      return;
    }
    if (this.active === p) this.startTurn(other(team), now);
  }

  getPublicState(): TeamRelayState {
    return {
      mode: 'teamRelay',
      teams: {
        A: { id: 'A', score: this.score.A, members: this.members.A.slice() },
        B: { id: 'B', score: this.score.B, members: this.members.B.slice() },
      },
      chain: tail(this.chain),
      currentWord: this.currentWord,
      requiredLetter: lastLetter(this.currentWord),
      activeTeam: this.activeTeam,
      activePlayerId: this.active,
      turnDeadline: this.turnDeadline,
      targetScore: this.config.targetScore,
      deadline: this.deadline,
      winner: this.winner,
    };
  }

  isRoundOver(): boolean {
    return this.winner !== null;
  }

  winningTeam(): TeamId | 'DRAW' | null {
    return this.winner;
  }

  computeScores() {
    const book = new ScoreBook(this.ctx.players);
    for (const [p, row] of Object.entries(this.book.toRecord())) Object.assign(book.row(p), row);
    if (this.winner === 'A' || this.winner === 'B') for (const p of this.members[this.winner]) book.add(p, RELAY_WIN_BONUS);
    return book.toRecord();
  }

  getPlayerStatus(p: PlayerId): PlayerRoundStatus {
    return { eliminated: false, lives: null, team: this.teamOf.get(p) ?? null };
  }
}

export const teamRelayMode: ModeDefinition<'teamRelay'> = { id: 'teamRelay', create: (c) => new TeamRelayMode(c) };
