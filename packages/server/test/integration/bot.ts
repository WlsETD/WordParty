import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  ClientToServerEvents,
  GameEvent,
  JoinResult,
  PrivateState,
  RoomSnapshot,
  ServerToClientEvents,
  SubmitResult,
} from '@wordparty/shared';
import type { Dictionary } from '../../src/dictionary/Dictionary.js';
import { trapBroken } from '../../src/dictionary/validator.js';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connect(url: string): Promise<ClientSocket> {
  const socket: ClientSocket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

export function unwrap<T>(res: Ack<T>): T {
  if (!res.ok) throw new Error(`request failed: ${res.error}`);
  return res.data;
}

const CHAINABLE = 'abcdefghilmnoprstw';

/**
 * A scripted client. With autoplay on it answers whenever the current mode lets it, at a
 * human-ish pace that stays under the rate limit.
 */
export class Bot {
  socket!: ClientSocket;
  playerId: string | null = null;
  token = '';
  code = '';
  snapshot: RoomSnapshot | null = null;
  priv: PrivateState | null = null;
  readonly events: GameEvent[] = [];
  readonly results: SubmitResult[] = [];
  readonly snapshots: RoomSnapshot[] = [];
  autoplay = false;
  /** Probability of deliberately submitting a bad word. */
  mistakeRate = 0.05;
  private busy = false;
  private nextAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly ownUsed = new Set<string>();
  private heatKey = '';

  constructor(
    readonly url: string,
    readonly name: string,
    readonly dict: Dictionary,
    readonly avatar = 0,
  ) {}

  async connect(): Promise<this> {
    this.socket = await connect(this.url);
    this.socket.on('state:snapshot', (s) => {
      this.snapshot = s;
      this.snapshots.push(s);
    });
    this.socket.on('state:private', (p) => (this.priv = p));
    this.socket.on('game:event', (e) => this.events.push(e));
    this.timer = setInterval(() => void this.step(), 30);
    return this;
  }

  private adopt(r: JoinResult): JoinResult {
    this.playerId = r.playerId;
    this.token = r.token;
    this.code = r.code;
    this.snapshot = r.snapshot;
    return r;
  }

  async create(role: 'display' | 'player' = 'player'): Promise<JoinResult> {
    const payload = role === 'display' ? ({ role } as const) : ({ role, name: this.name, avatar: this.avatar } as const);
    return this.adopt(unwrap(await this.socket.timeout(5000).emitWithAck('room:create', payload)));
  }

  async join(code: string): Promise<JoinResult> {
    return this.adopt(unwrap(await this.socket.timeout(5000).emitWithAck('room:join', { code, name: this.name, avatar: this.avatar })));
  }

  async rejoin(code: string, token: string): Promise<JoinResult> {
    return this.adopt(unwrap(await this.socket.timeout(5000).emitWithAck('room:rejoin', { code, token })));
  }

  submit(word: string, targetId?: string): Promise<SubmitResult> {
    return this.socket.timeout(5000).emitWithAck('game:submit', { word, ...(targetId ? { targetId } : {}) });
  }

  disconnect(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.socket.disconnect();
  }

  /** Waits until a snapshot matches. */
  waitFor(pred: (s: RoomSnapshot) => boolean, timeoutMs = 30_000): Promise<RoomSnapshot> {
    return new Promise((resolve, reject) => {
      if (this.snapshot && pred(this.snapshot)) return resolve(this.snapshot);
      const t = setTimeout(() => {
        this.socket.off('state:snapshot', on);
        reject(new Error(`${this.name}: timed out waiting (phase ${this.snapshot?.phase})`));
      }, timeoutMs);
      const on = (s: RoomSnapshot) => {
        if (pred(s)) {
          clearTimeout(t);
          this.socket.off('state:snapshot', on);
          resolve(s);
        }
      };
      this.socket.on('state:snapshot', on);
    });
  }

  private pickWord(letter: string, used: Set<string>, opts: { traps?: Parameters<typeof trapBroken>[1][]; chain?: boolean } = {}): string | null {
    const list = this.dict.wordsStartingWith(letter);
    const min = this.snapshot?.setup.modifiers.minLength ?? 3;
    const banned = this.snapshot?.setup.modifiers.bannedLetters ?? [];
    const blocked = this.priv?.blockedLetters ?? [];
    const start = Math.floor(Math.random() * list.length);
    for (let i = 0; i < list.length; i++) {
      const w = list[(start + i) % list.length];
      if (w.length < min || w.length > 8 || used.has(w) || this.ownUsed.has(w)) continue;
      if (banned.some((l) => w.includes(l)) || blocked.some((l) => w.slice(1).includes(l))) continue;
      if (opts.chain && !CHAINABLE.includes(w[w.length - 1])) continue;
      if (opts.traps?.some((t) => trapBroken(w, t))) continue;
      return w;
    }
    return null;
  }

  /** Decides what to send for the current state, or null to wait. */
  private decide(): { word: string; targetId?: string } | null {
    const s = this.snapshot;
    const me = this.playerId;
    if (!s || !me || s.phase !== 'ROUND' || !s.modeState) return null;
    const meP = s.players.find((p) => p.id === me);
    if (!meP || meP.eliminated) return null;
    const m = s.modeState;
    switch (m.mode) {
      case 'flash': {
        const w = this.pickWord(m.startLetter, new Set(m.grabbed.map((g) => g.word)));
        return w ? { word: w } : null;
      }
      case 'precise': {
        const lane = m.lanes.find((l) => l.playerId === me);
        if (!lane || lane.out) return null;
        const w = this.pickWord(lane.requiredLetter, new Set([lane.lastWord]), { chain: true });
        return w ? { word: w } : null;
      }
      case 'bomb': {
        if (m.holderId !== me) return null;
        const w = this.pickWord(m.requiredLetter, new Set([m.currentWord]), { chain: true });
        if (!w) return null;
        const targets = s.players.filter((p) => p.id !== me && (m.lives[p.id] ?? 0) > 0).map((p) => p.id);
        const strict = targets.filter((p) => p !== m.passedFromId);
        const pool = strict.length ? strict : targets;
        return { word: w, targetId: Math.random() < 0.5 ? pool[Math.floor(Math.random() * pool.length)] : undefined };
      }
      case 'lastStand': {
        if (m.heatDeadline === null) return null;
        const key = `${m.heat}`;
        if (key !== this.heatKey) {
          this.heatKey = key;
          this.ownUsed.clear();
        }
        const w = this.pickWord(m.startLetter, new Set());
        return w ? { word: w } : null;
      }
      case 'teamRelay': {
        if (m.activePlayerId !== me) return null;
        const w = this.pickWord(m.requiredLetter, new Set([m.currentWord, ...m.chain.map((c) => c.word)]), { chain: true });
        return w ? { word: w } : null;
      }
      case 'coopChain': {
        if (m.lastPlayerId === me || m.completed) return null;
        const w = this.pickWord(m.requiredLetter, new Set([m.currentWord, ...m.chain.map((c) => c.word)]), { chain: true });
        return w ? { word: w } : null;
      }
      case 'trapChain': {
        if (m.activePlayerId !== me) return null;
        const w = this.pickWord(m.requiredLetter, new Set([m.currentWord, ...m.history.map((c) => c.word)]), { chain: true, traps: m.traps });
        return w ? { word: w } : null;
      }
    }
  }

  private async step(): Promise<void> {
    if (!this.autoplay || this.busy || Date.now() < this.nextAt || !this.socket.connected) return;
    const action = this.decide();
    if (!action) return;
    this.busy = true;
    try {
      const word = Math.random() < this.mistakeRate ? 'qqqxz' : action.word;
      const res = await this.submit(word, action.targetId);
      this.results.push(res);
      if (res.ok) this.ownUsed.add(res.word);
    } catch {
      // timeouts during disconnects are fine
    } finally {
      this.busy = false;
      // ≥110 ms between messages keeps each bot under 10 msg/s.
      this.nextAt = Date.now() + 110 + Math.random() * 120;
    }
  }
}
