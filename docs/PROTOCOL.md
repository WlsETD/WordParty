# 接字派對 Word Chain Party — Client/Server Protocol

> Generated from `packages/shared/src` by `npm run gen:protocol`. Do not edit by hand.
> Import the types directly in TypeScript clients: `import type { ... } from '@wordparty/shared'`.

## 1. Connection

- Transport: **Socket.IO v4** (WebSocket). Connect with `socket.io-client`:

  ```ts
  import { io, Socket } from 'socket.io-client';
  import type { ClientToServerEvents, ServerToClientEvents } from '@wordparty/shared';
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, { transports: ['websocket'] });
  ```

- All messages are JSON. Requests use Socket.IO acknowledgements:
  `socket.emit('room:join', payload, (res) => …)` or `await socket.timeout(5000).emitWithAck('room:join', payload)`.
- Every request ack is `Ack<T>` = `{ ok: true, data }` or `{ ok: false, error: ErrorCode }`.
  `game:submit` answers with `SubmitResult` and `time:ping` with `TimeSync`.
- Health check: `GET /healthz` → `{ ok: true, rooms: number }`.

## 2. The server is the only referee

The server owns all timers, word validation, scoring and elimination. Clients only send input
(`game:submit`, `game:useItem`, host controls) and render what the server sends.

- `state:snapshot` carries the **whole** public room state. It is sent every **100 ms** while the
  phase is `COUNTDOWN` or `ROUND`, and on every change otherwise. Just replace your state with it.
- All times are **server timestamps in ms** (`deadline`, `turnDeadline`, `phaseEndsAt`, …).
  Draw countdowns from them using a clock offset:
  1. send `time:ping { t0: Date.now() }`; on the ack, `rtt = Date.now() − t0`,
     `offset = serverNow − (t0 + rtt / 2)`;
  2. server time ≈ `Date.now() + offset`. Repeat a few times and keep the lowest-rtt sample.
  Each snapshot also includes `serverNow`.
- `game:event` messages are one-off notifications for animation (word accepted, BOOM, eliminated…).
  Never derive state from them; the next snapshot already contains the result.
- `state:private` goes only to its owner: items, Lock letters, shield/star status, personal deadline.

## 3. Typical flows

**TV / display**
1. `room:create { role: 'display' }` → `JoinResult` with `code` (e.g. `PQ7K`, show it and a QR code of the join URL).
2. Render `state:snapshot`. A display can use host controls (`host:setup`, `host:start`, `host:kick`, `host:backToLobby`).

**Phone / player**
1. `room:join { code, name, avatar }` → `JoinResult`. **Save `code` + `token`** (e.g. in localStorage).
2. The first player to join is the host (`snapshot.hostId`, `players[].isHost`).
3. In `ROUND`, send `game:submit { word }`; show `SubmitResult.reason` on failure.
   Bomb Pass: add `targetId` (or omit it for a random allowed target).
4. On disconnect, reconnect and send `room:rejoin { code, token }` within **60 s** to keep your seat,
   score and place in turn order. Joining a second socket with the same token kicks the first (`room:kicked { reason: 'REPLACED' }`).

**Game phases** — `LOBBY → COUNTDOWN (3 s) → ROUND → ROUND_END (6 s) → COUNTDOWN … → FINAL`.
A setup has 1–10 *stages* (mode + rounds). More than one stage is a tournament (錦標賽); scores add up across all rounds.

## 4. Limits

| Rule | Value |
|---|---|
| Players per room | 2–10 (displays do not count) |
| Room code | 4 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0 O 1 I), case-insensitive |
| Nickname | 1–8 characters: letters (any language), digits, `_`, single spaces; unique in the room (case-insensitive) |
| Avatar | integer 0–11 |
| Reconnect grace | 60 s, then the seat is released (host passes to the next player) |
| Idle room | destroyed after 10 min with no client messages (`room:closed { reason: 'IDLE' }`) |
| Rate limit | 10 messages/s per connection, burst 20; extra messages get `RATE_LIMITED`; persistent flooding disconnects |
| Max message size | 4 KB |
| Joining | only in `LOBBY` or `FINAL`; mid-game only `room:rejoin` works |

## 5. Client → Server

| Event | Payload | Ack response | Description |
|---|---|---|---|
| `room:create` | `CreateRoomPayload` | `Ack<JoinResult>` | Create a room. A display creates an empty room; a player creates it and becomes host. |
| `room:join` | `JoinRoomPayload` | `Ack<JoinResult>` | Join a room in the LOBBY or FINAL phase. |
| `room:rejoin` | `RejoinPayload` | `Ack<JoinResult>` | Reclaim your seat (player or display) after a disconnect, within 60 s. Works in any phase. |
| `room:leave` | — | `Ack<null>` | Leave the room for good (your seat is released immediately). |
| `player:setAvatar` | `{ avatar: number }` | `Ack<null>` | Lobby only: change your avatar. |
| `host:kick` | `{ playerId: PlayerId }` | `Ack<null>` | Host or display: remove a player. |
| `host:setup` | `GameSetupInput` | `Ack<RoomSnapshot['setup']>` | Host or display, in LOBBY or FINAL: choose modes / tournament stages and modifiers. |
| `host:start` | — | `Ack<null>` | Host or display: start the game (from LOBBY or FINAL). Needs at least 2 connected players. |
| `host:backToLobby` | — | `Ack<null>` | Host or display, FINAL only: go back to the lobby (scores reset). |
| `game:submit` | `SubmitPayload` | `SubmitResult` | Submit a word. The ack tells you whether it was accepted and why not. |
| `game:useItem` | `UseItemPayload` | `Ack<null>` | Use an item. |
| `time:ping` | `{ t0: number }` | `TimeSync` | Clock sync: `offset ≈ serverNow − (t0 + rtt/2)`. |

## 6. Server → Client

| Event | Payload | Description |
|---|---|---|
| `state:snapshot` | `RoomSnapshot` | Full room state. Sent every 100 ms during COUNTDOWN/ROUND, otherwise when something changes. |
| `state:private` | `PrivateState` | Your private state (items, blocked letters, …). Sent when it changes. |
| `game:event` | `GameEvent` | Something happened (word accepted, bomb exploded, …). Use for animations and toasts. |
| `room:kicked` | `{ reason: 'KICKED' \| 'REPLACED' \| 'EXPIRED' }` | You were removed from the room. |
| `room:closed` | `{ reason: 'IDLE' \| 'EMPTY' }` | The room was destroyed. |
| `server:error` | `{ error: ErrorCode; message?: string }` | An error not tied to a request, e.g. RATE_LIMITED. |

## 7. Modes at a glance

| Mode | Who may answer | Required start | Scoring | Ends when |
|---|---|---|---|---|
| `flash` 閃電搶答 | everyone, any time | `startLetter` | word length; each word scores once (first come) | time up |
| `precise` 精準接龍 | everyone, own chain | own lane `requiredLetter` | length × combo (×1.5 at 3, ×2 at 6); error −2; 3 errors = out | time up / all out |
| `bomb` 炸彈傳遞 | the holder | last letter of `currentWord` | 2 per pass + 10 per player outlasted | one player left |
| `lastStand` 末位淘汰 | every living player, own words | heat `startLetter` | letters + 10 per player outlasted; lowest heat score is out | one player left |
| `teamRelay` 組隊接力 | `activePlayerId` | `requiredLetter` | 5 per word; winning team +20 each | team reaches target / time up |
| `coopChain` 合作長龍 | anyone except `lastPlayerId` | `requiredLetter` | 3 per word; all +5 per milestone, +20 on completion | target reached / time up |
| `trapChain` 陷阱接龍 | `activePlayerId` | `requiredLetter` | word length; trap −3 and −1 life; timeout −1 life; +10 per player outlasted | one player left / time up |

Modifiers (`bannedLetters`, `minLength`, `itemsEnabled`) apply to every mode.

## 8. Types

### Errors (`errors.ts`)

#### `SubmitFailReason`

Why a submitted word was rejected. The client shows a message for each code.

| Code | Meaning (suggested UI copy) |
|---|---|
| `INVALID_CHARS` | Only letters a–z are allowed |
| `TOO_SHORT` | Shorter than the minimum length |
| `WRONG_START` | Does not start with the required letter |
| `NOT_IN_DICT` | Not in the dictionary |
| `ALREADY_USED` | Already used this round |
| `BANNED_LETTER` | Contains a letter banned by a rule modifier |
| `BLOCKED_LETTER` | Contains a letter blocked by a Lock item |
| `TRAP_HIT` | Stepped on a trap rule (Trap Chain) – this costs a life |
| `NOT_YOUR_TURN` | Not your turn (or, in Co-op, you just played) |
| `ROUND_NOT_ACTIVE` | No round is running, or your time is up |
| `ELIMINATED` | You are out of this round |
| `INVALID_TARGET` | Bomb Pass: you cannot pass to that player |
| `RATE_LIMITED` | Too many messages |

```ts
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
```

#### `ErrorCode`

Error codes for request/response style messages (everything except word submissions).

```ts
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
```

### Messages (`protocol.ts`)

#### `Ack`

Every request that takes an ack callback answers with this shape.

```ts
export type Ack<T> = { ok: true; data: T } | { ok: false; error: ErrorCode; message?: string };
```

#### `AckFn`

```ts
export type AckFn<T> = (res: Ack<T>) => void;
```

#### `ClientRole`

`display` is the shared TV/laptop screen. It does not play, but it may use host controls.

```ts
export type ClientRole = 'display' | 'player';
```

#### `JoinResult`

Returned when you create, join or rejoin a room. Store `token` to reconnect.

```ts
export interface JoinResult {
  code: string;
  role: ClientRole;
  /** Your player id; null for a display. */
  playerId: PlayerId | null;
  /** Reconnect token. Send it with `room:rejoin` within 60 s of a disconnect. */
  token: string;
  snapshot: RoomSnapshot;
}
```

#### `CreateRoomPayload`

```ts
export type CreateRoomPayload =
  | { role: 'display' }
  | { role: 'player'; name: string; avatar: number };
```

#### `JoinRoomPayload`

```ts
export interface JoinRoomPayload {
  /** 4-character room code (case-insensitive). */
  code: string;
  name: string;
  /** 0–11 */
  avatar: number;
}
```

#### `RejoinPayload`

```ts
export interface RejoinPayload {
  code: string;
  token: string;
}
```

#### `SubmitPayload`

```ts
export interface SubmitPayload {
  word: string;
  /** Bomb Pass: who to pass the bomb to. If omitted, the server picks a random allowed player. */
  targetId?: PlayerId;
}
```

#### `SubmitResult`

```ts
export type SubmitResult =
  | { ok: true; word: string; points: number }
  | { ok: false; reason: SubmitFailReason; /** Points lost (Precise, Trap Chain). */ penalty?: number };
```

#### `UseItemPayload`

```ts
export interface UseItemPayload {
  item: ItemType;
  /** Required for `hourglass` and `lock`. */
  targetId?: PlayerId;
  /** Required for `lock`: the letter a–z to block. */
  letter?: string;
}
```

#### `TimeSync`

```ts
export interface TimeSync {
  /** The `t0` you sent. */
  t0: number;
  serverNow: number;
}
```

#### `ClientToServerEvents`

Client → server messages. Each takes a payload (if any) and an ack callback.
With socket.io-client: `socket.emit('room:join', payload, (res) => …)`.

```ts
export interface ClientToServerEvents {
  /** Create a room. A display creates an empty room; a player creates it and becomes host. */
  'room:create': (payload: CreateRoomPayload, ack: AckFn<JoinResult>) => void;
  /** Join a room in the LOBBY or FINAL phase. */
  'room:join': (payload: JoinRoomPayload, ack: AckFn<JoinResult>) => void;
  /** Reclaim your seat (player or display) after a disconnect, within 60 s. Works in any phase. */
  'room:rejoin': (payload: RejoinPayload, ack: AckFn<JoinResult>) => void;
  /** Leave the room for good (your seat is released immediately). */
  'room:leave': (ack: AckFn<null>) => void;
  /** Lobby only: change your avatar. */
  'player:setAvatar': (payload: { avatar: number }, ack: AckFn<null>) => void;
  /** Host or display: remove a player. */
  'host:kick': (payload: { playerId: PlayerId }, ack: AckFn<null>) => void;
  /** Host or display, in LOBBY or FINAL: choose modes / tournament stages and modifiers. */
  'host:setup': (payload: GameSetupInput, ack: AckFn<RoomSnapshot['setup']>) => void;
  /** Host or display: start the game (from LOBBY or FINAL). Needs at least 2 connected players. */
  'host:start': (ack: AckFn<null>) => void;
  /** Host or display, FINAL only: go back to the lobby (scores reset). */
  'host:backToLobby': (ack: AckFn<null>) => void;
  /** Submit a word. The ack tells you whether it was accepted and why not. */
  'game:submit': (payload: SubmitPayload, ack: (res: SubmitResult) => void) => void;
  /** Use an item. */
  'game:useItem': (payload: UseItemPayload, ack: AckFn<null>) => void;
  /** Clock sync: `offset ≈ serverNow − (t0 + rtt/2)`. */
  'time:ping': (payload: { t0: number }, ack: (res: TimeSync) => void) => void;
}
```

#### `ServerToClientEvents`

Server → client messages.

```ts
export interface ServerToClientEvents {
  /** Full room state. Sent every 100 ms during COUNTDOWN/ROUND, otherwise when something changes. */
  'state:snapshot': (snapshot: RoomSnapshot) => void;
  /** Your private state (items, blocked letters, …). Sent when it changes. */
  'state:private': (state: PrivateState) => void;
  /** Something happened (word accepted, bomb exploded, …). Use for animations and toasts. */
  'game:event': (event: GameEvent) => void;
  /** You were removed from the room. */
  'room:kicked': (payload: { reason: 'KICKED' | 'REPLACED' | 'EXPIRED' }) => void;
  /** The room was destroyed. */
  'room:closed': (payload: { reason: 'IDLE' | 'EMPTY' }) => void;
  /** An error not tied to a request, e.g. RATE_LIMITED. */
  'server:error': (payload: { error: ErrorCode; message?: string }) => void;
}
```

### State (`state.ts`)

#### `PlayerId`

```ts
export type PlayerId = string;
```

#### `Phase`

Game state machine:
`LOBBY → COUNTDOWN → ROUND → ROUND_END → (COUNTDOWN for the next round | FINAL)`.
From `FINAL` the host can start again (→ COUNTDOWN) or return to `LOBBY`.

```ts
export type Phase = 'LOBBY' | 'COUNTDOWN' | 'ROUND' | 'ROUND_END' | 'FINAL';
```

#### `TeamId`

```ts
export type TeamId = 'A' | 'B';
```

#### `PlayerPublic`

```ts
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
```

#### `WordEntry`

A word that was accepted, as shown in chains and grids.

```ts
export interface WordEntry {
  word: string;
  playerId: PlayerId;
  points: number;
  /** Server timestamp when it was accepted. */
  at: number;
}
```

#### `FlashState`

```ts
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
```

#### `PreciseLane`

```ts
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
```

#### `PreciseState`

```ts
export interface PreciseState {
  mode: 'precise';
  startWord: string;
  deadline: number;
  maxErrors: number;
  lanes: PreciseLane[];
}
```

#### `FuseStage`

```ts
export type FuseStage = 'idle' | 'fuse1' | 'fuse2' | 'fuse3' | 'critical';
```

#### `BombState`

```ts
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
```

#### `LastStandState`

```ts
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
```

#### `TeamInfo`

```ts
export interface TeamInfo {
  id: TeamId;
  score: number;
  members: PlayerId[];
}
```

#### `TeamRelayState`

```ts
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
```

#### `CoopChainState`

```ts
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
```

#### `TrapRule`

One trap rule. A word that breaks it costs a life.

```ts
export type TrapRule =
  | { kind: 'NO_LETTER'; letter: string }
  | { kind: 'NO_END_LETTER'; letter: string }
  | { kind: 'MAX_LENGTH'; length: number };
```

#### `TrapChainState`

```ts
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
```

#### `ModePublicState`

```ts
export type ModePublicState =
  | FlashState
  | PreciseState
  | BombState
  | LastStandState
  | TeamRelayState
  | CoopChainState
  | TrapChainState;
```

#### `RoundScore`

```ts
export interface RoundScore {
  playerId: PlayerId;
  points: number;
  /** Words accepted this round. */
  words: number;
  longestWord: string | null;
}
```

#### `RoundResult`

```ts
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
```

#### `PlayerStats`

```ts
export interface PlayerStats {
  longestWord: string | null;
  bestCombo: number;
  wordsAccepted: number;
  itemsUsed: number;
}
```

#### `FinalStanding`

```ts
export interface FinalStanding {
  playerId: PlayerId;
  score: number;
  /** 1-based; tied scores share a rank. */
  rank: number;
  stats: PlayerStats;
}
```

#### `FinalResult`

```ts
export interface FinalResult {
  standings: FinalStanding[];
}
```

#### `RoomSnapshot`

Full room state broadcast to everyone in the room (every 100 ms while a round runs).

```ts
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
```

#### `PrivateState`

State only the owning player receives.

```ts
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
```

#### `GameEvent`

Discrete things that happened, for animations and toasts. State is always in the snapshot.

```ts
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
```

### Modes and setup (`modes.ts`)

#### `ModeId`

Game modes.

| id | 名稱 | Summary |
|---|---|---|
| `flash` | 閃電搶答 | Everyone gets the same start letter; each word scores once, first come first served |
| `precise` | 精準接龍 | Everyone builds their own chain; valid words score, errors cost points, combos multiply |
| `bomb` | 炸彈傳遞 | A shared hidden fuse; answer then pass the bomb; explosions cost lives |
| `lastStand` | 末位淘汰 | Short heats; the lowest scorer of each heat is eliminated |
| `teamRelay` | 組隊接力 | Two teams alternate on one shared chain; first to the target wins |
| `coopChain` | 合作長龍 | Everyone builds one chain together toward a target |
| `trapChain` | 陷阱接龍 | Turn-based chain with hidden-in-plain-sight trap rules that cost lives |

```ts
export type ModeId = 'flash' | 'precise' | 'bomb' | 'lastStand' | 'teamRelay' | 'coopChain' | 'trapChain';
```

#### `MODE_IDS`

```ts
export const MODE_IDS: readonly ModeId[] = [
  'flash',
  'precise',
  'bomb',
  'lastStand',
  'teamRelay',
  'coopChain',
  'trapChain',
];
```

#### `FlashConfig`

```ts
export interface FlashConfig {
  /** Round length (ms). */
  roundMs: number;
}
```

#### `PreciseConfig`

```ts
export interface PreciseConfig {
  roundMs: number;
  /** Errors allowed before the player is out for the round. */
  maxErrors: number;
  /** Points lost per error or repeat. */
  wrongPenalty: number;
}
```

#### `BombConfig`

```ts
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
```

#### `LastStandConfig`

```ts
export interface LastStandConfig {
  /** Length of one heat (ms). */
  heatMs: number;
  /** Pause between heats (ms). */
  heatGapMs: number;
}
```

#### `TeamRelayConfig`

```ts
export interface TeamRelayConfig {
  /** Time per turn (ms). */
  turnMs: number;
  /** First team to this many words wins. */
  targetScore: number;
  /** Hard time limit for the round (ms). */
  roundMs: number;
}
```

#### `CoopChainConfig`

```ts
export interface CoopChainConfig {
  /** Words needed to complete the chain. */
  target: number;
  roundMs: number;
}
```

#### `TrapChainConfig`

```ts
export interface TrapChainConfig {
  turnMs: number;
  /** Lives per player (1–3). */
  lives: number;
  /** Number of trap rules per round (1–3). */
  trapCount: number;
  roundMs: number;
}
```

#### `ModeConfigMap`

```ts
export interface ModeConfigMap {
  flash: FlashConfig;
  precise: PreciseConfig;
  bomb: BombConfig;
  lastStand: LastStandConfig;
  teamRelay: TeamRelayConfig;
  coopChain: CoopChainConfig;
  trapChain: TrapChainConfig;
}
```

#### `MODE_DEFAULTS`

Default config for each mode.

```ts
export const MODE_DEFAULTS: { [K in ModeId]: ModeConfigMap[K] } = {
  flash: { roundMs: 30_000 },
  precise: { roundMs: 45_000, maxErrors: 3, wrongPenalty: 2 },
  bomb: { lives: 2, fuseMinMs: 20_000, fuseMaxMs: 45_000, minTurnMs: 3_000, explosionPauseMs: 2_000 },
  lastStand: { heatMs: 20_000, heatGapMs: 3_000 },
  teamRelay: { turnMs: 10_000, targetScore: 20, roundMs: 180_000 },
  coopChain: { target: 30, roundMs: 90_000 },
  trapChain: { turnMs: 10_000, lives: 2, trapCount: 2, roundMs: 180_000 },
};
```

#### `MODE_LIMITS`

Allowed [min, max] for every numeric config field. Values outside are clamped by the server.

```ts
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
```

#### `MODE_ITEMS`

Items each mode supports (when items are enabled).

```ts
export const MODE_ITEMS: { [K in ModeId]: readonly ItemType[] } = {
  flash: ['hourglass', 'lock', 'star2x'],
  precise: ['hourglass', 'lock', 'shield', 'star2x'],
  bomb: ['hourglass', 'lock', 'shield', 'star2x'],
  lastStand: ['hourglass', 'lock', 'shield', 'star2x'],
  teamRelay: ['hourglass', 'lock', 'shield', 'star2x'],
  coopChain: ['star2x'],
  trapChain: ['hourglass', 'lock', 'shield', 'star2x'],
};
```

#### `Modifiers`

Rule modifiers that apply on top of any mode.

```ts
export interface Modifiers {
  /** Lowercase letters no word may contain (e.g. `["e"]`). */
  bannedLetters: string[];
  /** Minimum word length (2–10). */
  minLength: number;
  /** Hand out items each round. */
  itemsEnabled: boolean;
}
```

#### `DEFAULT_MODIFIERS`

```ts
export const DEFAULT_MODIFIERS: Modifiers = {
  bannedLetters: [],
  minLength: 3,
  itemsEnabled: false,
};
```

#### `StageConfig`

One stage of a game: a mode played for a number of rounds.

```ts
export type StageConfig = {
  [K in ModeId]: {
    mode: K;
    /** Number of rounds of this mode (1–5). */
    rounds: number;
    config: ModeConfigMap[K];
  };
}[ModeId];
```

#### `StageInput`

Stage as sent by the host: rounds and config fields are optional and fall back to defaults.

```ts
export type StageInput = {
  [K in ModeId]: {
    mode: K;
    rounds?: number;
    config?: Partial<ModeConfigMap[K]>;
  };
}[ModeId];
```

#### `GameSetup`

Full game setup. A single mode is one stage; a tournament (錦標賽) is several stages
whose scores are added together.

```ts
export interface GameSetup {
  stages: StageConfig[];
  modifiers: Modifiers;
}
```

#### `GameSetupInput`

What the host sends with `host:setup`.

```ts
export interface GameSetupInput {
  /** 1–10 stages. */
  stages: StageInput[];
  modifiers?: Partial<Modifiers>;
}
```

#### `TOURNAMENT_ALL_MODES`

A tournament preset that plays every mode once.

```ts
export const TOURNAMENT_ALL_MODES: GameSetupInput = {
  stages: MODE_IDS.map((mode) => ({ mode, rounds: 1 }) as StageInput),
};
```

### Items (`items.ts`)

#### `ItemType`

Items (enabled with the `itemsEnabled` modifier).

| Item | Target | Effect |
|---|---|---|
| `hourglass` 縮時沙漏 | another player | Removes 3 s from the target's current (or next) time limit |
| `lock` 封鎖鎖頭 | another player + a letter | The target's next word may not contain that letter (except as its first letter) |
| `shield` 護盾 | self | Blocks one explosion, one error, one trap, one timeout or one elimination |
| `star2x` 雙倍星星 | self | Your next accepted word scores double |

Each player receives one of every item the current mode supports at the start of each round.
Eliminated players may still throw `hourglass` and `lock` at living players.

```ts
export type ItemType = 'hourglass' | 'lock' | 'shield' | 'star2x';
```

#### `ITEM_TYPES`

```ts
export const ITEM_TYPES: readonly ItemType[] = ['hourglass', 'lock', 'shield', 'star2x'];
```

#### `TARGETED_ITEMS`

Items that need a `targetId`.

```ts
export const TARGETED_ITEMS: readonly ItemType[] = ['hourglass', 'lock'];
```

#### `ItemState`

```ts
export interface ItemState {
  type: ItemType;
  count: number;
  /** Server timestamp (ms) until which this player cannot use any item; 0 when ready. */
  cooldownUntil: number;
}
```

### Constants (`constants.ts`)

#### `ROOM_CODE_ALPHABET`

Characters used in room codes. 0, O, 1 and I are excluded because they are easy to confuse.

```ts
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
```

#### `ROOM_CODE_LENGTH`

```ts
export const ROOM_CODE_LENGTH = 4;
```

#### `MIN_PLAYERS`

```ts
export const MIN_PLAYERS = 2;
```

#### `MAX_PLAYERS`

```ts
export const MAX_PLAYERS = 10;
```

#### `NICKNAME_MIN`

Nicknames: 1–8 characters (counted as Unicode code points).

```ts
export const NICKNAME_MIN = 1;
```

#### `NICKNAME_MAX`

```ts
export const NICKNAME_MAX = 8;
```

#### `AVATAR_COUNT`

Number of selectable avatars (avatarKind 0–11).

```ts
export const AVATAR_COUNT = 12;
```

#### `RECONNECT_GRACE_MS`

A disconnected player keeps their seat for this long and can rejoin with their token.

```ts
export const RECONNECT_GRACE_MS = 60_000;
```

#### `ROOM_IDLE_MS`

A room with no client activity for this long is destroyed.

```ts
export const ROOM_IDLE_MS = 10 * 60_000;
```

#### `TICK_MS`

Server tick and state broadcast interval.

```ts
export const TICK_MS = 100;
```

#### `COUNTDOWN_MS`

```ts
export const COUNTDOWN_MS = 3_000;
```

#### `ROUND_END_MS`

```ts
export const ROUND_END_MS = 6_000;
```

#### `MAX_WORD_LENGTH`

Longest word the server will even look at.

```ts
export const MAX_WORD_LENGTH = 45;
```

#### `RATE_LIMIT`

Per-connection message rate limit (token bucket).

```ts
export const RATE_LIMIT = {
  /** Tokens refilled per second. */
  perSecond: 10,
  /** Bucket size (burst). */
  burst: 20,
  /** Dropped messages tolerated before the connection is closed. */
  maxStrikes: 60,
} as const;
```

#### `ITEM_COOLDOWN_MS`

Item tuning.

```ts
export const ITEM_COOLDOWN_MS = 8_000;
```

#### `HOURGLASS_PENALTY_MS`

Hourglass: time removed from the target.

```ts
export const HOURGLASS_PENALTY_MS = 3_000;
```
