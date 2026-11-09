import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket } from 'socket.io';
import {
  ITEM_TYPES,
  RATE_LIMIT,
  TICK_MS,
  type Ack,
  type ClientToServerEvents,
  type ErrorCode,
  type ItemType,
  type JoinResult,
  type ServerToClientEvents,
} from '@wordparty/shared';
import { systemClock, type Clock } from '../core/clock.js';
import { RateLimiter } from '../core/rateLimiter.js';
import { mathRng, type Rng } from '../core/rng.js';
import type { Dictionary } from '../dictionary/Dictionary.js';
import type { Member, Room } from '../rooms/Room.js';
import { RoomManager, type ManagerOutput } from '../rooms/RoomManager.js';
import { createStaticHandler } from './static.js';

interface SocketData {
  code?: string;
  memberId?: string;
  limiter?: RateLimiter;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface GameServerOptions {
  dict: Dictionary;
  clock?: Clock;
  rng?: Rng;
  tickMs?: number;
  countdownMs?: number;
  roundEndMs?: number;
  graceMs?: number;
  idleMs?: number;
  /** Skip mode config clamping (tests only). */
  unsafeConfig?: boolean;
  corsOrigin?: string | string[];
  rateLimit?: { perSecond: number; burst: number; maxStrikes: number };
  /** Built web app to serve at `/` and `/tv`. Omit to serve only the API and /healthz. */
  staticDir?: string;
}

export interface GameServer {
  http: HttpServer;
  io: IO;
  manager: RoomManager;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (error: ErrorCode, message?: string): Ack<never> => ({ ok: false, error, ...(message ? { message } : {}) });
const channel = (code: string, memberId: string) => `${code}:${memberId}`;

/** Creates the HTTP + Socket.IO server. Nothing listens until `listen()`. */
export function createGameServer(opts: GameServerOptions): GameServer {
  const clock = opts.clock ?? systemClock;
  const rng = opts.rng ?? mathRng;
  const limits = opts.rateLimit ?? RATE_LIMIT;

  const serveWeb = opts.staticDir ? createStaticHandler(opts.staticDir) : null;

  const http = createServer((req, res) => {
    if (req.url?.split('?')[0] === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: manager.size }));
      return;
    }
    if (serveWeb?.(req, res)) return;
    res.writeHead(404).end();
  });

  const io: IO = new Server(http, {
    cors: { origin: opts.corsOrigin ?? '*' },
    maxHttpBufferSize: 4096,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  /** memberKey → socket id currently bound to that seat. */
  const seats = new Map<string, string>();

  const unbind = (socket: ClientSocket) => {
    const { code, memberId } = socket.data;
    if (code && memberId) {
      socket.leave(code);
      socket.leave(channel(code, memberId));
      if (seats.get(channel(code, memberId)) === socket.id) seats.delete(channel(code, memberId));
    }
    socket.data.code = undefined;
    socket.data.memberId = undefined;
  };

  const kickSockets = (code: string, memberId: string, reason: 'KICKED' | 'REPLACED' | 'EXPIRED') => {
    const ids = io.sockets.adapter.rooms.get(channel(code, memberId));
    for (const id of [...(ids ?? [])]) {
      const s = io.sockets.sockets.get(id);
      if (!s) continue;
      s.emit('room:kicked', { reason });
      unbind(s);
    }
  };

  const output: ManagerOutput = {
    snapshot: (code, snap) => io.to(code).emit('state:snapshot', snap),
    privateState: (code, id, st) => io.to(channel(code, id)).emit('state:private', st),
    event: (code, e) => io.to(code).emit('game:event', e),
    removed: (code, id, reason) => kickSockets(code, id, reason),
    closed: (code, reason) => {
      io.to(code).emit('room:closed', { reason });
      for (const id of [...(io.sockets.adapter.rooms.get(code) ?? [])]) {
        const s = io.sockets.sockets.get(id);
        if (s) unbind(s);
      }
    },
  };

  const manager = new RoomManager(
    {
      clock,
      rng,
      dict: opts.dict,
      countdownMs: opts.countdownMs,
      roundEndMs: opts.roundEndMs,
      unsafeConfig: opts.unsafeConfig,
      graceMs: opts.graceMs,
      idleMs: opts.idleMs,
    },
    output,
  );

  const bind = (socket: ClientSocket, room: Room, m: Member): JoinResult => {
    const key = channel(room.code, m.id);
    const previous = seats.get(key);
    if (previous && previous !== socket.id) {
      const old = io.sockets.sockets.get(previous);
      if (old) {
        old.emit('room:kicked', { reason: 'REPLACED' });
        unbind(old);
      }
    }
    socket.data.code = room.code;
    socket.data.memberId = m.id;
    socket.join([room.code, key]);
    seats.set(key, socket.id);
    const now = clock.now();
    room.flush(now, true);
    const ps = room.privateState(m.id);
    if (ps) socket.emit('state:private', ps);
    return { code: room.code, role: m.role, playerId: m.role === 'player' ? m.id : null, token: m.token, snapshot: room.snapshot(now) };
  };

  const current = (socket: ClientSocket): { room: Room; memberId: string } | null => {
    const { code, memberId } = socket.data;
    if (!code || !memberId) return null;
    const room = manager.get(code);
    if (!room || !room.member(memberId)) return null;
    return { room, memberId };
  };

  io.on('connection', (socket: ClientSocket) => {
    socket.data.limiter = new RateLimiter(clock, limits.perSecond, limits.burst);

    // Rate limit every incoming message.
    socket.use((packet, next) => {
      const limiter = socket.data.limiter!;
      if (limiter.take()) return next();
      const ack = packet[packet.length - 1];
      if (typeof ack === 'function') {
        ack(packet[0] === 'game:submit' ? { ok: false, reason: 'RATE_LIMITED' } : fail('RATE_LIMITED'));
      } else {
        socket.emit('server:error', { error: 'RATE_LIMITED' });
      }
      if (limiter.strikes > limits.maxStrikes) socket.disconnect(true);
    });

    /** Wraps a handler so a missing ack or a thrown error never crashes the server. */
    const on = <E extends keyof ClientToServerEvents>(
      event: E,
      handler: (args: unknown[], reply: (res: unknown) => void) => void,
    ) => {
      socket.on(event, ((...args: unknown[]) => {
        const last = args[args.length - 1];
        const reply = typeof last === 'function' ? (last as (r: unknown) => void) : () => {};
        const params = typeof last === 'function' ? args.slice(0, -1) : args;
        try {
          const ctx = current(socket);
          if (ctx) ctx.room.touch(clock.now());
          handler(params, reply);
        } catch (err) {
          console.error(`[gateway] ${event} failed`, err);
          reply(event === 'game:submit' ? { ok: false, reason: 'ROUND_NOT_ACTIVE' } : fail('INVALID_PAYLOAD'));
        }
      }) as never);
    };

    on('room:create', ([p], reply) => {
      if (current(socket)) return reply(fail('ALREADY_IN_ROOM'));
      if (!isObj(p) || (p.role !== 'display' && p.role !== 'player')) return reply(fail('INVALID_PAYLOAD'));
      const now = clock.now();
      const room = manager.create();
      if (p.role === 'display') return reply({ ok: true, data: bind(socket, room, room.addDisplay(now)) });
      const res = room.join(p.name, p.avatar, now);
      if (!res.ok) {
        manager.destroy(room.code, 'EMPTY');
        return reply(res);
      }
      reply({ ok: true, data: bind(socket, room, res.data) });
    });

    on('room:join', ([p], reply) => {
      if (current(socket)) return reply(fail('ALREADY_IN_ROOM'));
      if (!isObj(p)) return reply(fail('INVALID_PAYLOAD'));
      const room = manager.get(p.code);
      if (!room) return reply(fail('ROOM_NOT_FOUND'));
      const res = room.join(p.name, p.avatar, clock.now());
      if (!res.ok) return reply(res);
      reply({ ok: true, data: bind(socket, room, res.data) });
    });

    on('room:rejoin', ([p], reply) => {
      if (current(socket)) return reply(fail('ALREADY_IN_ROOM'));
      if (!isObj(p)) return reply(fail('INVALID_PAYLOAD'));
      const room = manager.get(p.code);
      if (!room) return reply(fail('ROOM_NOT_FOUND'));
      const res = room.rejoin(p.token, clock.now());
      if (!res.ok) return reply(res);
      reply({ ok: true, data: bind(socket, room, res.data) });
    });

    on('room:leave', (_args, reply) => {
      const ctx = current(socket);
      if (!ctx) return reply(fail('NOT_IN_ROOM'));
      unbind(socket);
      ctx.room.remove(ctx.memberId, clock.now());
      reply({ ok: true, data: null });
    });

    on('player:setAvatar', ([p], reply) => {
      const ctx = current(socket);
      if (!ctx) return reply(fail('NOT_IN_ROOM'));
      if (!isObj(p)) return reply(fail('INVALID_PAYLOAD'));
      reply(ctx.room.setAvatar(ctx.memberId, p.avatar));
    });

    on('host:kick', ([p], reply) => {
      const ctx = current(socket);
      if (!ctx) return reply(fail('NOT_IN_ROOM'));
      if (!isObj(p) || typeof p.playerId !== 'string') return reply(fail('INVALID_PAYLOAD'));
      reply(ctx.room.kick(ctx.memberId, p.playerId, clock.now()));
    });

    on('host:setup', ([p], reply) => {
      const ctx = current(socket);
      if (!ctx) return reply(fail('NOT_IN_ROOM'));
      reply(ctx.room.configure(ctx.memberId, p));
    });

    on('host:start', (_args, reply) => {
      const ctx = current(socket);
      if (!ctx) return reply(fail('NOT_IN_ROOM'));
      reply(ctx.room.start(ctx.memberId, clock.now()));
    });

    on('host:backToLobby', (_args, reply) => {
      const ctx = current(socket);
      if (!ctx) return reply(fail('NOT_IN_ROOM'));
      reply(ctx.room.backToLobby(ctx.memberId));
    });

    on('game:submit', ([p], reply) => {
      const ctx = current(socket);
      if (!ctx) return reply({ ok: false, reason: 'ROUND_NOT_ACTIVE' });
      if (!isObj(p) || typeof p.word !== 'string') return reply({ ok: false, reason: 'INVALID_CHARS' });
      const targetId = typeof p.targetId === 'string' ? p.targetId : undefined;
      reply(ctx.room.submit(ctx.memberId, { word: p.word.slice(0, 64), targetId }, clock.now()));
    });

    on('game:useItem', ([p], reply) => {
      const ctx = current(socket);
      if (!ctx) return reply(fail('NOT_IN_ROOM'));
      if (!isObj(p) || !ITEM_TYPES.includes(p.item as ItemType)) return reply(fail('INVALID_PAYLOAD'));
      reply(
        ctx.room.useItem(
          ctx.memberId,
          {
            item: p.item as ItemType,
            targetId: typeof p.targetId === 'string' ? p.targetId : undefined,
            letter: typeof p.letter === 'string' ? p.letter.toLowerCase() : undefined,
          },
          clock.now(),
        ),
      );
    });

    on('time:ping', ([p], reply) => {
      const t0 = isObj(p) && typeof p.t0 === 'number' ? p.t0 : 0;
      reply({ t0, serverNow: clock.now() });
    });

    socket.on('disconnect', () => {
      const ctx = current(socket);
      if (!ctx) return;
      const key = channel(ctx.room.code, ctx.memberId);
      if (seats.get(key) === socket.id) {
        seats.delete(key);
        ctx.room.disconnect(ctx.memberId, clock.now());
      }
    });
  });

  const timer = setInterval(() => {
    try {
      manager.tick(clock.now());
    } catch (err) {
      console.error('[tick] failed', err);
    }
  }, opts.tickMs ?? TICK_MS);
  timer.unref();

  return {
    http,
    io,
    manager,
    listen: (port, host = '0.0.0.0') =>
      new Promise((resolve) => http.listen(port, host, () => resolve((http.address() as AddressInfo).port))),
    close: () =>
      new Promise((resolve) => {
        clearInterval(timer);
        io.close(() => resolve());
      }),
  };
}
