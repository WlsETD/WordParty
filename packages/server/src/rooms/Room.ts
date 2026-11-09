import { randomBytes } from 'node:crypto';
import {
  AVATAR_COUNT,
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  ROOM_IDLE_MS,
  type Ack,
  type ClientRole,
  type GameEvent,
  type GameSetup,
  type PlayerId,
  type PlayerPublic,
  type PrivateState,
  type RoomSnapshot,
  type SubmitPayload,
  type SubmitResult,
  type UseItemPayload,
} from '@wordparty/shared';
import { sanitizeNickname } from '../core/nickname.js';
import { GameEngine, type EngineOptions } from '../game/GameEngine.js';

export interface Member {
  id: string;
  role: ClientRole;
  token: string;
  name: string;
  avatar: number;
  connected: boolean;
  disconnectedAt: number | null;
}

/** Where a room sends its output. The Socket.IO gateway implements this; tests can record it. */
export interface RoomOutput {
  snapshot(code: string, snapshot: RoomSnapshot): void;
  privateState(code: string, memberId: string, state: PrivateState): void;
  event(code: string, event: GameEvent): void;
  removed(code: string, memberId: string, reason: 'KICKED' | 'EXPIRED'): void;
}

export interface RoomOptions {
  graceMs?: number;
  idleMs?: number;
}

const newToken = () => randomBytes(18).toString('base64url');

/**
 * A room: members (players and displays), host, reconnection and the game engine.
 * Has no knowledge of sockets.
 */
export class Room {
  /** Members in join order. */
  private readonly members: Member[] = [];
  hostId: PlayerId | null = null;
  readonly engine: GameEngine;
  lastActivityAt: number;
  private version = 0;
  private seq = 0;
  private readonly graceMs: number;
  private readonly idleMs: number;

  constructor(
    readonly code: string,
    engineOpts: EngineOptions,
    private readonly output: RoomOutput,
    opts: RoomOptions = {},
  ) {
    this.graceMs = opts.graceMs ?? RECONNECT_GRACE_MS;
    this.idleMs = opts.idleMs ?? ROOM_IDLE_MS;
    this.lastActivityAt = engineOpts.clock.now();
    this.engine = new GameEngine(engineOpts, {
      emit: (e) => this.output.event(this.code, e),
      isConnected: (p) => this.member(p)?.connected ?? false,
    });
  }

  // ───────────── Membership ─────────────

  member(id: string): Member | undefined {
    return this.members.find((m) => m.id === id);
  }

  get players(): Member[] {
    return this.members.filter((m) => m.role === 'player');
  }

  get isEmpty(): boolean {
    return this.members.length === 0;
  }

  touch(now: number): void {
    this.lastActivityAt = now;
  }

  isIdle(now: number): boolean {
    return now - this.lastActivityAt >= this.idleMs;
  }

  addDisplay(now: number): Member {
    const m: Member = { id: `D${++this.seq}`, role: 'display', token: newToken(), name: 'display', avatar: 0, connected: true, disconnectedAt: null };
    this.members.push(m);
    this.touch(now);
    return m;
  }

  join(rawName: unknown, avatar: unknown, now: number): Ack<Member> {
    if (this.engine.inGame) return { ok: false, error: 'GAME_IN_PROGRESS' };
    if (this.players.length >= MAX_PLAYERS) return { ok: false, error: 'ROOM_FULL' };
    const name = sanitizeNickname(rawName);
    if (!name) return { ok: false, error: 'NICKNAME_INVALID' };
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'NICKNAME_TAKEN' };
    if (!Number.isInteger(avatar) || (avatar as number) < 0 || (avatar as number) >= AVATAR_COUNT) return { ok: false, error: 'AVATAR_INVALID' };
    const m: Member = { id: `P${++this.seq}`, role: 'player', token: newToken(), name, avatar: avatar as number, connected: true, disconnectedAt: null };
    this.members.push(m);
    if (!this.hostId) this.hostId = m.id;
    this.touch(now);
    this.engine.dirty = true;
    return { ok: true, data: m };
  }

  rejoin(token: unknown, now: number): Ack<Member> {
    const m = typeof token === 'string' ? this.members.find((x) => x.token === token) : undefined;
    if (!m) return { ok: false, error: 'INVALID_TOKEN' };
    m.connected = true;
    m.disconnectedAt = null;
    this.touch(now);
    this.engine.dirty = true;
    if (m.role === 'player') this.engine.privateDirty.add(m.id);
    return { ok: true, data: m };
  }

  disconnect(id: string, now: number): void {
    const m = this.member(id);
    if (!m || !m.connected) return;
    m.connected = false;
    m.disconnectedAt = now;
    this.engine.dirty = true;
  }

  /** Removes a member right away (leave, kick, expired seat). */
  remove(id: string, now: number): void {
    const i = this.members.findIndex((m) => m.id === id);
    if (i < 0) return;
    const [m] = this.members.splice(i, 1);
    if (m.role === 'player') {
      this.engine.playerLeft(m.id, now);
      if (this.hostId === m.id) this.migrateHost();
    }
    this.engine.dirty = true;
  }

  private migrateHost(): void {
    const players = this.players;
    this.hostId = (players.find((p) => p.connected) ?? players[0])?.id ?? null;
  }

  /** Hosts and displays may use host controls. */
  canControl(id: string): boolean {
    const m = this.member(id);
    return !!m && (m.role === 'display' || m.id === this.hostId);
  }

  // ───────────── Host controls ─────────────

  kick(by: string, target: string, now: number): Ack<null> {
    if (!this.canControl(by)) return { ok: false, error: 'NOT_HOST' };
    const t = this.member(target);
    if (!t || t.role !== 'player' || t.id === by) return { ok: false, error: 'PLAYER_NOT_FOUND' };
    this.remove(t.id, now);
    this.output.removed(this.code, t.id, 'KICKED');
    return { ok: true, data: null };
  }

  configure(by: string, input: unknown): Ack<GameSetup> {
    if (!this.canControl(by)) return { ok: false, error: 'NOT_HOST' };
    return this.engine.configure(input);
  }

  start(by: string, now: number): Ack<null> {
    if (!this.canControl(by)) return { ok: false, error: 'NOT_HOST' };
    return this.engine.start(
      this.players.filter((p) => p.connected).map((p) => p.id),
      now,
    );
  }

  backToLobby(by: string): Ack<null> {
    if (!this.canControl(by)) return { ok: false, error: 'NOT_HOST' };
    return this.engine.backToLobby();
  }

  setAvatar(id: string, avatar: unknown): Ack<null> {
    const m = this.member(id);
    if (!m || m.role !== 'player') return { ok: false, error: 'NOT_IN_ROOM' };
    if (this.engine.phase !== 'LOBBY' && this.engine.phase !== 'FINAL') return { ok: false, error: 'BAD_PHASE' };
    if (!Number.isInteger(avatar) || (avatar as number) < 0 || (avatar as number) >= AVATAR_COUNT) return { ok: false, error: 'AVATAR_INVALID' };
    m.avatar = avatar as number;
    this.engine.dirty = true;
    return { ok: true, data: null };
  }

  // ───────────── Game actions ─────────────

  submit(id: string, payload: SubmitPayload, now: number): SubmitResult {
    const m = this.member(id);
    if (!m || m.role !== 'player') return { ok: false, reason: 'ELIMINATED' };
    return this.engine.submit(id, payload.word, { targetId: payload.targetId }, now);
  }

  useItem(id: string, payload: UseItemPayload, now: number): Ack<null> {
    const m = this.member(id);
    if (!m || m.role !== 'player') return { ok: false, error: 'NOT_IN_ROOM' };
    return this.engine.useItem(id, payload, now);
  }

  // ───────────── Tick & views ─────────────

  /** Advances the game, expires seats and pushes state. Called every TICK_MS. */
  tick(now: number): void {
    for (const m of [...this.members]) {
      if (!m.connected && m.disconnectedAt !== null && now - m.disconnectedAt >= this.graceMs) {
        this.remove(m.id, now);
        this.output.removed(this.code, m.id, 'EXPIRED');
      }
    }
    this.engine.tick(now);
    this.flush(now);
  }

  /** Sends the snapshot (always while a round is live, otherwise only when changed) and private states. */
  flush(now: number, force = false): void {
    const live = this.engine.phase === 'COUNTDOWN' || this.engine.phase === 'ROUND';
    if (force || live || this.engine.dirty) {
      this.engine.dirty = false;
      this.output.snapshot(this.code, this.snapshot(now));
    }
    for (const id of this.engine.privateDirty) {
      const ps = this.privateState(id);
      if (ps) this.output.privateState(this.code, id, ps);
    }
    this.engine.privateDirty.clear();
  }

  snapshot(now: number): RoomSnapshot {
    const e = this.engine;
    const players: PlayerPublic[] = this.players.map((m) => {
      const st = e.playerStatus(m.id);
      return {
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        connected: m.connected,
        isHost: m.id === this.hostId,
        score: e.totalScore(m.id),
        eliminated: st.eliminated,
        lives: st.lives,
        team: st.team,
      };
    });
    return {
      code: this.code,
      phase: e.phase,
      version: ++this.version,
      serverNow: now,
      hostId: this.hostId,
      players,
      setup: e.setup,
      stageIndex: e.stageIndex,
      roundInStage: e.roundInStage,
      roundNumber: e.roundNumber,
      totalRounds: e.totalRounds,
      phaseEndsAt: e.phaseEndsAt,
      modeState: e.modeState(now),
      lastRound: e.phase === 'ROUND_END' || e.phase === 'FINAL' ? e.lastRound : null,
      final: e.phase === 'FINAL' ? e.final : null,
    };
  }

  privateState(id: string): PrivateState | null {
    const m = this.member(id);
    if (!m || m.role !== 'player') return null;
    return { playerId: m.id, token: m.token, ...this.engine.privateParts(m.id) };
  }
}
