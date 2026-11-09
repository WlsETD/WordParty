import type { ErrorCode, SubmitFailReason } from './errors.js';
import type { ItemType } from './items.js';
import type { GameSetupInput } from './modes.js';
import type { GameEvent, PlayerId, PrivateState, RoomSnapshot } from './state.js';

/** Every request that takes an ack callback answers with this shape. */
export type Ack<T> = { ok: true; data: T } | { ok: false; error: ErrorCode; message?: string };

export type AckFn<T> = (res: Ack<T>) => void;

/** `display` is the shared TV/laptop screen. It does not play, but it may use host controls. */
export type ClientRole = 'display' | 'player';

/** Returned when you create, join or rejoin a room. Store `token` to reconnect. */
export interface JoinResult {
  code: string;
  role: ClientRole;
  /** Your player id; null for a display. */
  playerId: PlayerId | null;
  /** Reconnect token. Send it with `room:rejoin` within 60 s of a disconnect. */
  token: string;
  snapshot: RoomSnapshot;
}

export type CreateRoomPayload =
  | { role: 'display' }
  | { role: 'player'; name: string; avatar: number };

export interface JoinRoomPayload {
  /** 4-character room code (case-insensitive). */
  code: string;
  name: string;
  /** 0–11 */
  avatar: number;
}

export interface RejoinPayload {
  code: string;
  token: string;
}

export interface SubmitPayload {
  word: string;
  /** Bomb Pass: who to pass the bomb to. If omitted, the server picks a random allowed player. */
  targetId?: PlayerId;
}

export type SubmitResult =
  | { ok: true; word: string; points: number }
  | { ok: false; reason: SubmitFailReason; /** Points lost (Precise, Trap Chain). */ penalty?: number };

export interface UseItemPayload {
  item: ItemType;
  /** Required for `hourglass` and `lock`. */
  targetId?: PlayerId;
  /** Required for `lock`: the letter a–z to block. */
  letter?: string;
}

export interface TimeSync {
  /** The `t0` you sent. */
  t0: number;
  serverNow: number;
}

/**
 * Client → server messages. Each takes a payload (if any) and an ack callback.
 * With socket.io-client: `socket.emit('room:join', payload, (res) => …)`.
 */
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

/** Server → client messages. */
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
