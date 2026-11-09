import type { ItemType } from './items.js';

/**
 * Game modes.
 *
 * | id | 名稱 | Summary |
 * |---|---|---|
 * | `flash` | 閃電搶答 | Everyone gets the same start letter; each word scores once, first come first served |
 * | `precise` | 精準接龍 | Everyone builds their own chain; valid words score, errors cost points, combos multiply |
 * | `bomb` | 炸彈傳遞 | A shared hidden fuse; answer then pass the bomb; explosions cost lives |
 * | `lastStand` | 末位淘汰 | Short heats; the lowest scorer of each heat is eliminated |
 * | `teamRelay` | 組隊接力 | Two teams alternate on one shared chain; first to the target wins |
 * | `coopChain` | 合作長龍 | Everyone builds one chain together toward a target |
 * | `trapChain` | 陷阱接龍 | Turn-based chain with hidden-in-plain-sight trap rules that cost lives |
 */
export type ModeId = 'flash' | 'precise' | 'bomb' | 'lastStand' | 'teamRelay' | 'coopChain' | 'trapChain';

export const MODE_IDS: readonly ModeId[] = [
  'flash',
  'precise',
  'bomb',
  'lastStand',
  'teamRelay',
  'coopChain',
  'trapChain',
];

export interface FlashConfig {
  /** Round length (ms). */
  roundMs: number;
}

export interface PreciseConfig {
  roundMs: number;
  /** Errors allowed before the player is out for the round. */
  maxErrors: number;
  /** Points lost per error or repeat. */
  wrongPenalty: number;
}

export interface BombConfig {
  /** Lives per player (1–3). */
  lives: number;
  /** The fuse length is random in [fuseMinMs, fuseMaxMs] and hidden from clients. */
  fuseMinMs: number;
  fuseMaxMs: number;
  /** Every holder gets at least this long to answer, even if the fuse would burn out sooner. */
  minTurnMs: number;
  /** Pause after an explosion before the next fuse is lit. */
  explosionPauseMs: number;
}

export interface LastStandConfig {
  /** Length of one heat (ms). */
  heatMs: number;
  /** Pause between heats (ms). */
  heatGapMs: number;
}

export interface TeamRelayConfig {
  /** Time per turn (ms). */
  turnMs: number;
  /** First team to this many words wins. */
  targetScore: number;
  /** Hard time limit for the round (ms). */
  roundMs: number;
}

export interface CoopChainConfig {
  /** Words needed to complete the chain. */
  target: number;
  roundMs: number;
}

export interface TrapChainConfig {
  turnMs: number;
  /** Lives per player (1–3). */
  lives: number;
  /** Number of trap rules per round (1–3). */
  trapCount: number;
  roundMs: number;
}

export interface ModeConfigMap {
  flash: FlashConfig;
  precise: PreciseConfig;
  bomb: BombConfig;
  lastStand: LastStandConfig;
  teamRelay: TeamRelayConfig;
  coopChain: CoopChainConfig;
  trapChain: TrapChainConfig;
}

/** Default config for each mode. */
export const MODE_DEFAULTS: { [K in ModeId]: ModeConfigMap[K] } = {
  flash: { roundMs: 30_000 },
  precise: { roundMs: 45_000, maxErrors: 3, wrongPenalty: 2 },
  bomb: { lives: 2, fuseMinMs: 20_000, fuseMaxMs: 45_000, minTurnMs: 3_000, explosionPauseMs: 2_000 },
  lastStand: { heatMs: 20_000, heatGapMs: 3_000 },
  teamRelay: { turnMs: 10_000, targetScore: 20, roundMs: 180_000 },
  coopChain: { target: 30, roundMs: 90_000 },
  trapChain: { turnMs: 10_000, lives: 2, trapCount: 2, roundMs: 180_000 },
};

/** Allowed [min, max] for every numeric config field. Values outside are clamped by the server. */
export const MODE_LIMITS: { [K in ModeId]: { [F in keyof ModeConfigMap[K]]: readonly [number, number] } } = {
  flash: { roundMs: [10_000, 120_000] },
  precise: { roundMs: [15_000, 180_000], maxErrors: [1, 10], wrongPenalty: [0, 10] },
  bomb: {
    lives: [1, 3],
    fuseMinMs: [8_000, 90_000],
    fuseMaxMs: [8_000, 120_000],
    minTurnMs: [3_000, 10_000],
    explosionPauseMs: [1_000, 5_000],
  },
  lastStand: { heatMs: [10_000, 60_000], heatGapMs: [1_000, 10_000] },
  teamRelay: { turnMs: [5_000, 30_000], targetScore: [5, 50], roundMs: [30_000, 600_000] },
  coopChain: { target: [5, 100], roundMs: [30_000, 300_000] },
  trapChain: { turnMs: [5_000, 30_000], lives: [1, 3], trapCount: [1, 3], roundMs: [30_000, 600_000] },
};

/** Items each mode supports (when items are enabled). */
export const MODE_ITEMS: { [K in ModeId]: readonly ItemType[] } = {
  flash: ['hourglass', 'lock', 'star2x'],
  precise: ['hourglass', 'lock', 'shield', 'star2x'],
  bomb: ['hourglass', 'lock', 'shield', 'star2x'],
  lastStand: ['hourglass', 'lock', 'shield', 'star2x'],
  teamRelay: ['hourglass', 'lock', 'shield', 'star2x'],
  coopChain: ['star2x'],
  trapChain: ['hourglass', 'lock', 'shield', 'star2x'],
};

/** Rule modifiers that apply on top of any mode. */
export interface Modifiers {
  /** Lowercase letters no word may contain (e.g. `["e"]`). */
  bannedLetters: string[];
  /** Minimum word length (2–10). */
  minLength: number;
  /** Hand out items each round. */
  itemsEnabled: boolean;
}

export const DEFAULT_MODIFIERS: Modifiers = {
  bannedLetters: [],
  minLength: 3,
  itemsEnabled: false,
};

/** One stage of a game: a mode played for a number of rounds. */
export type StageConfig = {
  [K in ModeId]: {
    mode: K;
    /** Number of rounds of this mode (1–5). */
    rounds: number;
    config: ModeConfigMap[K];
  };
}[ModeId];

/** Stage as sent by the host: rounds and config fields are optional and fall back to defaults. */
export type StageInput = {
  [K in ModeId]: {
    mode: K;
    rounds?: number;
    config?: Partial<ModeConfigMap[K]>;
  };
}[ModeId];

/**
 * Full game setup. A single mode is one stage; a tournament (錦標賽) is several stages
 * whose scores are added together.
 */
export interface GameSetup {
  stages: StageConfig[];
  modifiers: Modifiers;
}

/** What the host sends with `host:setup`. */
export interface GameSetupInput {
  /** 1–10 stages. */
  stages: StageInput[];
  modifiers?: Partial<Modifiers>;
}

/** A tournament preset that plays every mode once. */
export const TOURNAMENT_ALL_MODES: GameSetupInput = {
  stages: MODE_IDS.map((mode) => ({ mode, rounds: 1 }) as StageInput),
};
