/** Characters used in room codes. 0, O, 1 and I are excluded because they are easy to confuse. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

/** Nicknames: 1–8 characters (counted as Unicode code points). */
export const NICKNAME_MIN = 1;
export const NICKNAME_MAX = 8;
/** Number of selectable avatars (avatarKind 0–11). */
export const AVATAR_COUNT = 12;

/** A disconnected player keeps their seat for this long and can rejoin with their token. */
export const RECONNECT_GRACE_MS = 60_000;
/** A room with no client activity for this long is destroyed. */
export const ROOM_IDLE_MS = 10 * 60_000;
/** Server tick and state broadcast interval. */
export const TICK_MS = 100;

export const COUNTDOWN_MS = 3_000;
export const ROUND_END_MS = 6_000;

/** Longest word the server will even look at. */
export const MAX_WORD_LENGTH = 45;

/** Per-connection message rate limit (token bucket). */
export const RATE_LIMIT = {
  /** Tokens refilled per second. */
  perSecond: 10,
  /** Bucket size (burst). */
  burst: 20,
  /** Dropped messages tolerated before the connection is closed. */
  maxStrikes: 60,
} as const;

/** Item tuning. */
export const ITEM_COOLDOWN_MS = 8_000;
/** Hourglass: time removed from the target. */
export const HOURGLASS_PENALTY_MS = 3_000;
