import {
  COUNTDOWN_MS,
  HOURGLASS_PENALTY_MS,
  ITEM_COOLDOWN_MS,
  MIN_PLAYERS,
  MODE_ITEMS,
  ROUND_END_MS,
  type Ack,
  type FinalResult,
  type GameEvent,
  type GameSetup,
  type ItemState,
  type ItemType,
  type ModePublicState,
  type Phase,
  type PlayerId,
  type PlayerStats,
  type RoundResult,
  type RoundScore,
  type SubmitResult,
  type TeamId,
  type UseItemPayload,
} from '@wordparty/shared';
import type { Clock } from '../core/clock.js';
import type { Rng } from '../core/rng.js';
import type { Dictionary } from '../dictionary/Dictionary.js';
import { validateWord } from '../dictionary/validator.js';
import type { GameMode, PlayerRoundStatus, RoundContext, SubmitOptions } from '../modes/GameMode.js';
import { createMode } from '../modes/registry.js';
import { DEFAULT_SETUP, normalizeSetup } from './setup.js';

export interface EngineOptions {
  clock: Clock;
  rng: Rng;
  dict: Dictionary;
  countdownMs?: number;
  roundEndMs?: number;
  /** Skip config clamping (tests only). */
  unsafeConfig?: boolean;
}

export interface EngineHooks {
  emit(event: GameEvent): void;
  isConnected(playerId: PlayerId): boolean;
}

interface PlayerItems {
  items: Map<ItemType, number>;
  cooldownUntil: number;
  shield: boolean;
  double: boolean;
  blocked: Set<string>;
}

const emptyStats = (): PlayerStats => ({ longestWord: null, bestCombo: 0, wordsAccepted: 0, itemsUsed: 0 });

/**
 * The game state machine: LOBBY → COUNTDOWN → ROUND → ROUND_END → (COUNTDOWN | FINAL).
 * Owns scores, stats and items; delegates round rules to a GameMode.
 */
export class GameEngine {
  phase: Phase = 'LOBBY';
  setup: GameSetup = structuredClone(DEFAULT_SETUP);
  stageIndex = 0;
  roundInStage = 0;
  roundNumber = 0;
  phaseEndsAt: number | null = null;
  mode: GameMode | null = null;
  lastRound: RoundResult | null = null;
  final: FinalResult | null = null;
  /** Players taking part in the current game, in seat order. */
  participants: PlayerId[] = [];

  private readonly totals = new Map<PlayerId, number>();
  private readonly stats = new Map<PlayerId, PlayerStats>();
  private readonly itemState = new Map<PlayerId, PlayerItems>();
  /** Players whose private state changed since the last flush. */
  readonly privateDirty = new Set<PlayerId>();
  /** Set when something changed that the snapshot shows. */
  dirty = true;

  private readonly countdownMs: number;
  private readonly roundEndMs: number;

  constructor(
    private readonly opts: EngineOptions,
    private readonly hooks: EngineHooks,
  ) {
    this.countdownMs = opts.countdownMs ?? COUNTDOWN_MS;
    this.roundEndMs = opts.roundEndMs ?? ROUND_END_MS;
  }

  get totalRounds(): number {
    return this.setup.stages.reduce((n, s) => n + s.rounds, 0);
  }

  get inGame(): boolean {
    return this.phase === 'COUNTDOWN' || this.phase === 'ROUND' || this.phase === 'ROUND_END';
  }

  // ───────────── Lobby controls ─────────────

  configure(input: unknown): Ack<GameSetup> {
    if (this.phase !== 'LOBBY' && this.phase !== 'FINAL') return { ok: false, error: 'BAD_PHASE' };
    const setup = normalizeSetup(input, this.opts.unsafeConfig);
    if (!setup) return { ok: false, error: 'INVALID_PAYLOAD' };
    this.setup = setup;
    this.dirty = true;
    return { ok: true, data: setup };
  }

  start(players: PlayerId[], now: number): Ack<null> {
    if (this.phase !== 'LOBBY' && this.phase !== 'FINAL') return { ok: false, error: 'BAD_PHASE' };
    if (players.length < MIN_PLAYERS) return { ok: false, error: 'NOT_ENOUGH_PLAYERS' };
    this.participants = players.slice();
    this.totals.clear();
    this.stats.clear();
    for (const p of players) {
      this.totals.set(p, 0);
      this.stats.set(p, emptyStats());
    }
    this.stageIndex = 0;
    this.roundInStage = 1;
    this.roundNumber = 1;
    this.lastRound = null;
    this.final = null;
    this.enterCountdown(now);
    return { ok: true, data: null };
  }

  backToLobby(): Ack<null> {
    if (this.phase !== 'FINAL') return { ok: false, error: 'BAD_PHASE' };
    this.phase = 'LOBBY';
    this.mode = null;
    this.lastRound = null;
    this.final = null;
    this.participants = [];
    this.totals.clear();
    this.stats.clear();
    this.itemState.clear();
    this.stageIndex = this.roundInStage = this.roundNumber = 0;
    this.phaseEndsAt = null;
    this.dirty = true;
    return { ok: true, data: null };
  }

  // ───────────── Ticking ─────────────

  tick(now: number): void {
    switch (this.phase) {
      case 'COUNTDOWN':
        if (now >= (this.phaseEndsAt ?? 0)) this.beginRound(now);
        break;
      case 'ROUND':
        this.mode!.onTick(now);
        if (this.mode!.isRoundOver(now)) this.endRound(now);
        break;
      case 'ROUND_END':
        if (now >= (this.phaseEndsAt ?? 0)) this.advance(now);
        break;
    }
  }

  private enterCountdown(now: number): void {
    this.phase = 'COUNTDOWN';
    this.phaseEndsAt = now + this.countdownMs;
    this.mode = null;
    this.dirty = true;
  }

  private beginRound(now: number): void {
    const stage = this.setup.stages[this.stageIndex];
    const mode = createMode(stage.mode, stage.config as never) as GameMode;
    this.mode = mode;
    this.phase = 'ROUND';
    this.phaseEndsAt = null;
    this.itemState.clear();
    const supported = this.setup.modifiers.itemsEnabled ? MODE_ITEMS[stage.mode] : [];
    for (const p of this.participants) {
      this.itemState.set(p, {
        items: new Map(supported.map((t) => [t, 1])),
        cooldownUntil: 0,
        shield: false,
        double: false,
        blocked: new Set(),
      });
      this.privateDirty.add(p);
    }
    mode.onStart(this.makeContext());
    this.dirty = true;
  }

  private endRound(now: number): void {
    const mode = this.mode!;
    const raw = mode.computeScores();
    const scores: RoundScore[] = this.participants.map((p) => ({
      playerId: p,
      points: raw[p]?.points ?? 0,
      words: raw[p]?.words ?? 0,
      longestWord: raw[p]?.longestWord ?? null,
    }));
    scores.sort((a, b) => b.points - a.points || b.words - a.words);
    for (const s of scores) this.totals.set(s.playerId, (this.totals.get(s.playerId) ?? 0) + s.points);
    this.lastRound = {
      stageIndex: this.stageIndex,
      mode: mode.id,
      roundInStage: this.roundInStage,
      scores,
      mvpId: scores.length && scores[0].points > 0 ? scores[0].playerId : null,
      ...(mode.winningTeam ? { winningTeam: mode.winningTeam() } : {}),
    };
    this.phase = 'ROUND_END';
    this.phaseEndsAt = now + this.roundEndMs;
    this.dirty = true;
  }

  private advance(now: number): void {
    const stage = this.setup.stages[this.stageIndex];
    if (this.roundInStage < stage.rounds) {
      this.roundInStage++;
    } else {
      this.stageIndex++;
      this.roundInStage = 1;
    }
    if (this.stageIndex >= this.setup.stages.length || this.participants.length < MIN_PLAYERS) {
      this.finish();
      return;
    }
    this.roundNumber++;
    this.enterCountdown(now);
  }

  private finish(): void {
    if (this.stageIndex >= this.setup.stages.length) this.stageIndex = this.setup.stages.length - 1;
    const rows = this.participants.map((p) => ({ playerId: p, score: this.totals.get(p) ?? 0, stats: { ...(this.stats.get(p) ?? emptyStats()) } }));
    rows.sort((a, b) => b.score - a.score);
    this.final = {
      standings: rows.map((r) => ({ ...r, rank: rows.findIndex((x) => x.score === r.score) + 1 })),
    };
    this.phase = 'FINAL';
    this.phaseEndsAt = null;
    this.dirty = true;
  }

  // ───────────── Player actions ─────────────

  submit(p: PlayerId, word: unknown, opts: SubmitOptions, now: number): SubmitResult {
    if (this.phase !== 'ROUND' || !this.mode) return { ok: false, reason: 'ROUND_NOT_ACTIVE' };
    if (!this.participants.includes(p)) return { ok: false, reason: 'ELIMINATED' };
    if (this.mode.getPlayerStatus(p).eliminated) return { ok: false, reason: 'ELIMINATED' };
    const res = this.mode.onSubmit(p, typeof word === 'string' ? word : '', now, opts);
    this.dirty = true;
    return res;
  }

  useItem(p: PlayerId, payload: UseItemPayload, now: number): Ack<null> {
    if (this.phase !== 'ROUND' || !this.mode) return { ok: false, error: 'BAD_PHASE' };
    const st = this.itemState.get(p);
    if (!st) return { ok: false, error: 'NOT_IN_ROOM' };
    const { item, targetId, letter } = payload;
    if ((st.items.get(item) ?? 0) <= 0) return { ok: false, error: 'ITEM_UNAVAILABLE' };
    if (now < st.cooldownUntil) return { ok: false, error: 'ITEM_COOLDOWN' };
    const selfAlive = !this.mode.getPlayerStatus(p).eliminated;

    if (item === 'hourglass' || item === 'lock') {
      if (!targetId || targetId === p || !this.itemState.has(targetId) || this.mode.getPlayerStatus(targetId).eliminated) {
        return { ok: false, error: 'INVALID_TARGET' };
      }
      if (item === 'hourglass') {
        if (!this.mode.applyTimePenalty?.(targetId, HOURGLASS_PENALTY_MS, now)) return { ok: false, error: 'ITEM_UNAVAILABLE' };
      } else {
        if (typeof letter !== 'string' || !/^[a-z]$/.test(letter)) return { ok: false, error: 'INVALID_PAYLOAD' };
        this.itemState.get(targetId)!.blocked.add(letter);
      }
      this.privateDirty.add(targetId);
    } else {
      if (!selfAlive) return { ok: false, error: 'ITEM_UNAVAILABLE' };
      if (item === 'shield') {
        if (st.shield) return { ok: false, error: 'ITEM_UNAVAILABLE' };
        st.shield = true;
      } else {
        if (st.double) return { ok: false, error: 'ITEM_UNAVAILABLE' };
        st.double = true;
      }
    }
    st.items.set(item, (st.items.get(item) ?? 0) - 1);
    st.cooldownUntil = now + ITEM_COOLDOWN_MS;
    const stats = this.stats.get(p);
    if (stats) stats.itemsUsed++;
    this.privateDirty.add(p);
    this.dirty = true;
    this.hooks.emit({
      type: 'ITEM_USED',
      by: p,
      item,
      targetId: item === 'hourglass' || item === 'lock' ? targetId! : null,
      ...(item === 'lock' ? { letter } : {}),
      at: now,
    });
    return { ok: true, data: null };
  }

  /** A participant left for good (kicked or seat expired). */
  playerLeft(p: PlayerId, now: number): void {
    if (!this.participants.includes(p)) return;
    if (this.phase === 'ROUND') this.mode?.onPlayerLeft?.(p, now);
    // Keep them in the standings if the game is over; otherwise drop them.
    if (this.phase !== 'FINAL') {
      this.participants = this.participants.filter((x) => x !== p);
      this.itemState.delete(p);
    }
    this.dirty = true;
  }

  // ───────────── Views ─────────────

  totalScore(p: PlayerId): number {
    return this.totals.get(p) ?? 0;
  }

  playerStatus(p: PlayerId): PlayerRoundStatus {
    if (this.mode && (this.phase === 'ROUND' || this.phase === 'ROUND_END') && this.participants.includes(p)) {
      return this.mode.getPlayerStatus(p);
    }
    return { eliminated: false, lives: null, team: null };
  }

  modeState(now: number): ModePublicState | null {
    return this.mode && (this.phase === 'ROUND' || this.phase === 'ROUND_END') ? this.mode.getPublicState(now) : null;
  }

  privateParts(p: PlayerId): {
    items: ItemState[];
    blockedLetters: string[];
    shieldActive: boolean;
    doubleActive: boolean;
    personalDeadline: number | null;
    team: TeamId | null;
  } {
    const st = this.itemState.get(p);
    return {
      items: st ? [...st.items].map(([type, count]) => ({ type, count, cooldownUntil: st.cooldownUntil })) : [],
      blockedLetters: st ? [...st.blocked] : [],
      shieldActive: st?.shield ?? false,
      doubleActive: st?.double ?? false,
      personalDeadline: this.phase === 'ROUND' ? (this.mode?.personalDeadline?.(p) ?? null) : null,
      team: this.playerStatus(p).team,
    };
  }

  // ───────────── Mode context ─────────────

  private makeContext(): RoundContext {
    const { rng, dict, clock } = this.opts;
    const modifiers = this.setup.modifiers;
    const banned = new Set(modifiers.bannedLetters);
    const players = this.participants.slice();
    return {
      rng,
      dict,
      players,
      modifiers,
      now: () => clock.now(),
      isConnected: (p) => this.hooks.isConnected(p),
      validate: (p, word, rules) =>
        validateWord(dict, word, {
          ...rules,
          minLength: modifiers.minLength,
          bannedLetters: modifiers.bannedLetters,
          blockedLetters: this.itemState.get(p)?.blocked,
        }),
      accept: (p, word, basePoints, extra) => {
        const st = this.itemState.get(p);
        let points = basePoints;
        if (st?.double && points > 0) {
          points *= 2;
          st.double = false;
          this.privateDirty.add(p);
        }
        if (st && st.blocked.size) {
          st.blocked.clear();
          this.privateDirty.add(p);
        }
        const s = this.stats.get(p);
        if (s) {
          s.wordsAccepted++;
          if (!s.longestWord || word.length > s.longestWord.length) s.longestWord = word;
          if (extra?.combo && extra.combo > s.bestCombo) s.bestCombo = extra.combo;
        }
        this.dirty = true;
        this.hooks.emit({ type: 'WORD_ACCEPTED', playerId: p, word, points, ...(extra?.combo ? { combo: extra.combo } : {}), at: clock.now() });
        return points;
      },
      reject: (p, word, reason, penalty = 0) => {
        this.hooks.emit({ type: 'WORD_REJECTED', playerId: p, word, reason, penalty, at: clock.now() });
      },
      consumeShield: (p) => {
        const st = this.itemState.get(p);
        if (!st?.shield) return false;
        st.shield = false;
        this.privateDirty.add(p);
        this.hooks.emit({ type: 'SHIELD_BLOCKED', playerId: p, at: clock.now() });
        return true;
      },
      emit: (e) => {
        this.dirty = true;
        this.hooks.emit(e);
      },
      startLetter: (exclude = []) => dict.randomStartLetter(rng, [...banned, ...exclude]),
      seedWord: (accept = () => true) => dict.randomSeedWord(rng, (w) => ![...banned].some((l) => w.includes(l)) && accept(w)),
    };
  }
}
