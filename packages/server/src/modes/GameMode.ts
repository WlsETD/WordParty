import type {
  GameEvent,
  ModeConfigMap,
  ModeId,
  ModePublicState,
  Modifiers,
  PlayerId,
  SubmitFailReason,
  SubmitResult,
  TeamId,
  TrapRule,
} from '@wordparty/shared';
import type { Rng } from '../core/rng.js';
import type { Dictionary } from '../dictionary/Dictionary.js';
import type { ValidationResult } from '../dictionary/validator.js';

/** Rules a mode passes to `ctx.validate`; modifiers and Lock letters are added by the engine. */
export interface ModeRules {
  requiredStart: string | null;
  used: ReadonlySet<string>;
  traps?: readonly TrapRule[];
}

/** What the engine gives a mode for one round. */
export interface RoundContext {
  readonly rng: Rng;
  readonly dict: Dictionary;
  /** Participants in seat order, fixed for the round. */
  readonly players: readonly PlayerId[];
  readonly modifiers: Modifiers;
  now(): number;
  isConnected(playerId: PlayerId): boolean;
  /** Validates a word with the mode's rules plus min length, banned letters and Lock letters. */
  validate(playerId: PlayerId, word: string, rules: ModeRules): ValidationResult;
  /**
   * Records an accepted word: applies Star ×2 (consuming it), clears Lock letters,
   * updates stats and emits WORD_ACCEPTED. Returns the final points.
   */
  accept(playerId: PlayerId, word: string, basePoints: number, extra?: { combo?: number }): number;
  /** Emits WORD_REJECTED (for the shared screen). */
  reject(playerId: PlayerId, word: string, reason: SubmitFailReason, penalty?: number): void;
  /** Uses up the player's shield if active (emits SHIELD_BLOCKED). */
  consumeShield(playerId: PlayerId): boolean;
  emit(event: GameEvent): void;
  /** A random start letter that is not banned. */
  startLetter(exclude?: Iterable<string>): string;
  /** A random seed word without banned letters. */
  seedWord(accept?: (w: string) => boolean): string;
}

export interface PlayerRoundStatus {
  eliminated: boolean;
  lives: number | null;
  team: TeamId | null;
}

export interface ModeRoundScore {
  points: number;
  words: number;
  longestWord: string | null;
}

export interface SubmitOptions {
  targetId?: PlayerId;
}

/**
 * A game mode plug-in. One instance runs one round.
 * Add a mode by implementing this and registering it in `registry.ts`.
 */
export interface GameMode<Id extends ModeId = ModeId> {
  readonly id: Id;
  readonly config: ModeConfigMap[Id];
  onStart(ctx: RoundContext): void;
  onSubmit(playerId: PlayerId, word: string, now: number, opts: SubmitOptions): SubmitResult;
  onTick(now: number): void;
  getPublicState(now: number): Extract<ModePublicState, { mode: Id }>;
  isRoundOver(now: number): boolean;
  computeScores(): Record<PlayerId, ModeRoundScore>;
  getPlayerStatus(playerId: PlayerId): PlayerRoundStatus;
  /** The player left the game for good (seat expired or kicked). */
  onPlayerLeft?(playerId: PlayerId, now: number): void;
  /** Hourglass. Returns false if it cannot affect the target. */
  applyTimePenalty?(playerId: PlayerId, ms: number, now: number): boolean;
  /** Personal deadline in simultaneous modes after an Hourglass hit. */
  personalDeadline?(playerId: PlayerId): number | null;
  /** Team Relay. */
  winningTeam?(): TeamId | 'DRAW' | null;
}

export interface ModeDefinition<Id extends ModeId = ModeId> {
  id: Id;
  create(config: ModeConfigMap[Id]): GameMode<Id>;
}
