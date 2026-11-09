/**
 * Why a submitted word was rejected. The client shows a message for each code.
 *
 * | Code | Meaning (suggested UI copy) |
 * |---|---|
 * | `INVALID_CHARS` | Only letters a–z are allowed |
 * | `TOO_SHORT` | Shorter than the minimum length |
 * | `WRONG_START` | Does not start with the required letter |
 * | `NOT_IN_DICT` | Not in the dictionary |
 * | `ALREADY_USED` | Already used this round |
 * | `BANNED_LETTER` | Contains a letter banned by a rule modifier |
 * | `BLOCKED_LETTER` | Contains a letter blocked by a Lock item |
 * | `TRAP_HIT` | Stepped on a trap rule (Trap Chain) – this costs a life |
 * | `NOT_YOUR_TURN` | Not your turn (or, in Co-op, you just played) |
 * | `ROUND_NOT_ACTIVE` | No round is running, or your time is up |
 * | `ELIMINATED` | You are out of this round |
 * | `INVALID_TARGET` | Bomb Pass: you cannot pass to that player |
 * | `RATE_LIMITED` | Too many messages |
 */
export type SubmitFailReason =
  | 'INVALID_CHARS'
  | 'TOO_SHORT'
  | 'WRONG_START'
  | 'NOT_IN_DICT'
  | 'ALREADY_USED'
  | 'BANNED_LETTER'
  | 'BLOCKED_LETTER'
  | 'TRAP_HIT'
  | 'NOT_YOUR_TURN'
  | 'ROUND_NOT_ACTIVE'
  | 'ELIMINATED'
  | 'INVALID_TARGET'
  | 'RATE_LIMITED';

/** Error codes for request/response style messages (everything except word submissions). */
export type ErrorCode =
  | 'INVALID_PAYLOAD'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_IN_PROGRESS'
  | 'NICKNAME_INVALID'
  | 'NICKNAME_TAKEN'
  | 'AVATAR_INVALID'
  | 'INVALID_TOKEN'
  | 'NOT_IN_ROOM'
  | 'ALREADY_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_ENOUGH_PLAYERS'
  | 'BAD_PHASE'
  | 'PLAYER_NOT_FOUND'
  | 'ITEM_UNAVAILABLE'
  | 'ITEM_COOLDOWN'
  | 'INVALID_TARGET'
  | 'RATE_LIMITED';
