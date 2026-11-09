import type { SubmitFailReason } from './errors.js';
import type { ItemState, ItemType } from './items.js';
import type { GameSetup, ModeId } from './modes.js';

export type PlayerId = string;

/**
 * Game state machine:
 * `LOBBY → COUNTDOWN → ROUND → ROUND_END → (COUNTDOWN for the next round | FINAL)`.
 * From `FINAL` the host can start again (→ COUNTDOWN) or return to `LOBBY`.
 */
export type Phase = 'LOBBY' | 'COUNTDOWN' | 'ROUND' | 'ROUND_END' | 'FINAL';

export type TeamId = 'A' | 'B';

export interface PlayerPublic {
  id: PlayerId;
  name: string;
  /** Avatar index 0–11. */
  avatar: number;
  /** False while the player is disconnected (seat held for 60 s). */
  connected: boolean;
  isHost: boolean;
  /** Total score across the whole game (all rounds and stages). */
  score: number;
  /** True when the player is out of the current round. */
  eliminated: boolean;
  /** Lives left in the current round (Bomb Pass, Trap Chain only). */
  lives: number | null;
  /** Team in Team Relay, otherwise null. */
  team: TeamId | null;
}

/** A word that was accepted, as shown in chains and grids. */
export interface WordEntry {
  word: string;
  playerId: PlayerId;
  points: number;
  /** Server timestamp when it was accepted. */
  at: number;
}

// ───────────────────────── Mode public states ─────────────────────────

export interface FlashState {
  mode: 'flash';
  startLetter: string;
  /** Round end (server timestamp). */
  deadline: number;
  /** Accepted words, oldest first. */
  grabbed: WordEntry[];
  /** Live round score per player. */
  scores: Record<PlayerId, number>;
}

export interface PreciseLane {
  playerId: PlayerId;
  /** Last word in this player's chain (starts as the shared start word). */
  lastWord: string;
  /** Letter the next word must start with. */
  requiredLetter: string;
  /** Accepted words so far. */
  count: number;
  combo: number;
  /** 1, 2 or 3; changes at combo 3 and 6. */
  flameTier: 0 | 1 | 2 | 3;
  errors: number;
  out: boolean;
  score: number;
}

export interface PreciseState {
  mode: 'precise';
  startWord: string;
  deadline: number;
  maxErrors: number;
  lanes: PreciseLane[];
}

export type FuseStage = 'idle' | 'fuse1' | 'fuse2' | 'fuse3' | 'critical';

export interface BombState {
  mode: 'bomb';
  /** Who holds the bomb (null during the post-explosion pause or when the round is over). */
  holderId: PlayerId | null;
  /** Who passed the bomb to the holder; the holder may not pass it straight back. */
  passedFromId: PlayerId | null;
  currentWord: string;
  requiredLetter: string;
  /** When the holder received the bomb (server timestamp). */
  turnStartedAt: number;
  /** Fuse stage for the bomb art, derived from the remaining fuse fraction. */
  fuseStage: FuseStage;
  /** Remaining fuse fraction 0–1 (rounded to 0.01) for drawing the fuse. */
  fuseFraction: number;
  /** While non-null, the round is paused after an explosion until this time. */
  pausedUntil: number | null;
  lastThrow: { from: PlayerId; to: PlayerId; word: string; at: number } | null;
  lastExplosion: { playerId: PlayerId; at: number; shielded: boolean } | null;
  lives: Record<PlayerId, number>;
  /** Player ids in the order they were eliminated (first out first). */
  eliminatedOrder: PlayerId[];
  wordsPassed: Record<PlayerId, number>;
}

export interface LastStandState {
  mode: 'lastStand';
  /** 1-based heat number. */
  heat: number;
  startLetter: string;
  /** End of the current heat, or null during the gap between heats. */
  heatDeadline: number | null;
  /** Start of the next heat during the gap, otherwise null. */
  nextHeatAt: number | null;
  /** Score in the current heat for each living player. */
  heatScores: Record<PlayerId, number>;
  /** Total letters scored in this round. */
  totals: Record<PlayerId, number>;
  /** Lowest living player right now (the danger zone). */
  dangerId: PlayerId | null;
  alive: PlayerId[];
  eliminatedOrder: PlayerId[];
  /** Who was eliminated at the end of the previous heat. */
  lastEliminatedId: PlayerId | null;
}

export interface TeamInfo {
  id: TeamId;
  score: number;
  members: PlayerId[];
}

export interface TeamRelayState {
  mode: 'teamRelay';
  teams: { A: TeamInfo; B: TeamInfo };
  /** Shared chain, newest last (at most the last 40). */
  chain: (WordEntry & { team: TeamId })[];
  currentWord: string;
  requiredLetter: string;
  activeTeam: TeamId;
  activePlayerId: PlayerId | null;
  turnDeadline: number;
  targetScore: number;
  deadline: number;
  winner: TeamId | 'DRAW' | null;
}

export interface CoopChainState {
  mode: 'coopChain';
  /** Shared chain, newest last (at most the last 40). `count` has the full length. */
  chain: WordEntry[];
  count: number;
  target: number;
  /** Chain lengths that unlock milestone bonuses (1/3 and 2/3 of the target). */
  milestones: number[];
  currentWord: string;
  requiredLetter: string;
  /** The player who added the last word; they cannot add the next one. */
  lastPlayerId: PlayerId | null;
  contributions: Record<PlayerId, number>;
  deadline: number;
  completed: boolean;
}

/** One trap rule. A word that breaks it costs a life. */
export type TrapRule =
  | { kind: 'NO_LETTER'; letter: string }
  | { kind: 'NO_END_LETTER'; letter: string }
  | { kind: 'MAX_LENGTH'; length: number };

export interface TrapChainState {
  mode: 'trapChain';
  currentWord: string;
  requiredLetter: string;
  activePlayerId: PlayerId | null;
  turnDeadline: number;
  deadline: number;
  traps: TrapRule[];
  /** Accepted words, newest last (at most the last 40). */
  history: WordEntry[];
  lives: Record<PlayerId, number>;
  eliminatedOrder: PlayerId[];
}

export type ModePublicState =
  | FlashState
  | PreciseState
  | BombState
  | LastStandState
  | TeamRelayState
  | CoopChainState
  | TrapChainState;

// ───────────────────────── Results ─────────────────────────

export interface RoundScore {
  playerId: PlayerId;
  points: number;
  /** Words accepted this round. */
  words: number;
  longestWord: string | null;
}

export interface RoundResult {
  stageIndex: number;
  mode: ModeId;
  /** 1-based round number within the stage. */
  roundInStage: number;
  /** Sorted by points, highest first. */
  scores: RoundScore[];
  mvpId: PlayerId | null;
  /** Team Relay only. */
  winningTeam?: TeamId | 'DRAW' | null;
}

export interface PlayerStats {
  longestWord: string | null;
  bestCombo: number;
  wordsAccepted: number;
  itemsUsed: number;
}

export interface FinalStanding {
  playerId: PlayerId;
  score: number;
  /** 1-based; tied scores share a rank. */
  rank: number;
  stats: PlayerStats;
}

export interface FinalResult {
  standings: FinalStanding[];
}

// ───────────────────────── Snapshots ─────────────────────────

/** Full room state broadcast to everyone in the room (every 100 ms while a round runs). */
export interface RoomSnapshot {
  code: string;
  phase: Phase;
  /** Increases whenever anything in the snapshot changes. */
  version: number;
  /** Server clock when the snapshot was built; use it with time:ping to sync clocks. */
  serverNow: number;
  hostId: PlayerId | null;
  players: PlayerPublic[];
  setup: GameSetup;
  /** Index into setup.stages of the current stage. */
  stageIndex: number;
  /** 1-based round within the current stage (0 in the lobby). */
  roundInStage: number;
  /** 1-based round across the whole game (0 in the lobby). */
  roundNumber: number;
  /** Total rounds across all stages. */
  totalRounds: number;
  /** End of COUNTDOWN / ROUND_END (server timestamp); null in other phases. */
  phaseEndsAt: number | null;
  /** Mode state while in COUNTDOWN (null), ROUND and ROUND_END. */
  modeState: ModePublicState | null;
  /** Set in ROUND_END and FINAL (the last round). */
  lastRound: RoundResult | null;
  /** Set in FINAL. */
  final: FinalResult | null;
}

/** State only the owning player receives. */
export interface PrivateState {
  playerId: PlayerId;
  /** Reconnect token (also returned on join). */
  token: string;
  items: ItemState[];
  /** Letters blocked for your next word by a Lock item. */
  blockedLetters: string[];
  shieldActive: boolean;
  doubleActive: boolean;
  /**
   * Your personal deadline (server timestamp) when an Hourglass shortened your time in a
   * simultaneous mode (Flash, Precise, Last Stand); otherwise null.
   */
  personalDeadline: number | null;
  /** Your team in Team Relay. */
  team: TeamId | null;
}

// ───────────────────────── Events ─────────────────────────

/** Discrete things that happened, for animations and toasts. State is always in the snapshot. */
export type GameEvent =
  | { type: 'WORD_ACCEPTED'; playerId: PlayerId; word: string; points: number; combo?: number; at: number }
  | { type: 'WORD_REJECTED'; playerId: PlayerId; word: string; reason: SubmitFailReason; penalty: number; at: number }
  | { type: 'BOMB_PASSED'; from: PlayerId; to: PlayerId; word: string; at: number }
  | { type: 'BOMB_EXPLODED'; playerId: PlayerId; livesLeft: number; shielded: boolean; at: number }
  | { type: 'PLAYER_ELIMINATED'; playerId: PlayerId; at: number }
  | { type: 'TURN_TIMEOUT'; playerId: PlayerId; livesLeft?: number; at: number }
  | { type: 'TRAP_HIT'; playerId: PlayerId; word: string; rule: TrapRule; livesLeft: number; at: number }
  | { type: 'SHIELD_BLOCKED'; playerId: PlayerId; at: number }
  | { type: 'ITEM_USED'; by: PlayerId; item: ItemType; targetId: PlayerId | null; letter?: string; at: number }
  | { type: 'MILESTONE'; index: number; count: number; at: number }
  | { type: 'HEAT_END'; heat: number; eliminatedId: PlayerId | null; at: number }
  | { type: 'TEAM_WIN'; team: TeamId; at: number }
  | { type: 'CHAIN_COMPLETE'; at: number };
