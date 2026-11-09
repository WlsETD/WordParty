import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  ClientToServerEvents,
  GameEvent,
  GameSetupInput,
  JoinResult,
  PrivateState,
  RoomSnapshot,
  ServerToClientEvents,
  SubmitResult,
  UseItemPayload,
} from '@wordparty/shared';
import { clearSession, loadSession, saveSession, type Role } from './session';
import { errorText } from './format';

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;

export type Conn = 'connecting' | 'online' | 'offline';
export interface TimedEvent {
  id: number;
  /** Server-clock time when it arrived. */
  at: number;
  event: GameEvent;
}
/** A submit result, or OFFLINE when the socket is down and nothing was sent. */
export type ClientSubmit = SubmitResult | { ok: false; reason: 'OFFLINE' };

const CALL_TIMEOUT_MS = 5000;
const RESYNC_MS = 30_000;

/**
 * Connection and room state for one screen.
 * `autoCreate` makes the screen open its own room (the TV). Otherwise the screen only joins.
 */
export function useGame(role: Role, autoCreate: boolean) {
  const [conn, setConn] = useState<Conn>('connecting');
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [priv, setPriv] = useState<PrivateState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [events, setEvents] = useState<TimedEvent[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const sockRef = useRef<Sock | null>(null);
  /** serverTime − localTime, measured with time:ping. */
  const offsetRef = useRef(0);
  const now = useCallback(() => Date.now() + offsetRef.current, []);

  const adopt = useCallback(
    (r: JoinResult) => {
      setJoined(true);
      setPlayerId(r.playerId);
      setSnapshot(r.snapshot);
      saveSession(role, { code: r.code, token: r.token });
    },
    [role],
  );

  const forget = useCallback(
    (msg: string | null) => {
      clearSession(role);
      setJoined(false);
      setPlayerId(null);
      setPriv(null);
      setSnapshot(null);
      if (msg) setNotice(msg);
    },
    [role],
  );

  useEffect(() => {
    const socket: Sock = io();
    sockRef.current = socket;
    let seq = 0;
    let bestRtt = Infinity;

    // Keep the sample with the smallest round trip; it is the most accurate.
    const sync = async () => {
      const t0 = Date.now();
      try {
        const res = await socket.timeout(3000).emitWithAck('time:ping', { t0 });
        const rtt = Date.now() - t0;
        if (rtt <= bestRtt) {
          bestRtt = rtt;
          offsetRef.current = res.serverNow - (t0 + rtt / 2);
        }
      } catch {
        /* try again next time */
      }
    };
    const resync = setInterval(() => {
      bestRtt = Infinity;
      void sync();
    }, RESYNC_MS);

    const create = async () => {
      try {
        const res = await socket.timeout(CALL_TIMEOUT_MS).emitWithAck('room:create', { role: 'display' });
        if (res.ok) adopt(res.data);
        else setNotice(errorText(res));
      } catch {
        setNotice('無法建立房間，請重新整理');
      }
    };

    socket.on('connect', async () => {
      setConn('online');
      void sync();
      const sess = loadSession(role);
      if (!sess) {
        if (autoCreate) void create();
        return;
      }
      try {
        const res = await socket.timeout(CALL_TIMEOUT_MS).emitWithAck('room:rejoin', { code: sess.code, token: sess.token });
        if (res.ok) {
          adopt(res.data);
        } else {
          // The room or the seat is gone: start fresh.
          forget(res.error === 'ROOM_NOT_FOUND' || res.error === 'INVALID_TOKEN' ? '房間或座位已失效' : null);
          if (autoCreate) void create();
        }
      } catch {
        // Keep the session; the next reconnect tries again.
      }
    });

    socket.on('disconnect', () => setConn('offline'));
    socket.on('connect_error', () => setConn('offline'));
    socket.on('state:snapshot', (s) => setSnapshot(s));
    socket.on('state:private', (p) => setPriv(p));
    socket.on('game:event', (event) => setEvents((list) => [...list.slice(-29), { id: ++seq, at: now(), event }]));
    socket.on('room:kicked', ({ reason }) =>
      forget(reason === 'KICKED' ? '你已被移出房間' : reason === 'REPLACED' ? '你已在另一個裝置加入' : '座位已逾時釋放'),
    );
    socket.on('room:closed', ({ reason }) => {
      forget(reason === 'IDLE' ? '房間因閒置 10 分鐘已關閉' : '房間已關閉');
      if (autoCreate) void create();
    });

    return () => {
      clearInterval(resync);
      socket.disconnect();
      sockRef.current = null;
    };
  }, [role, autoCreate, adopt, forget, now]);

  /** Sends a request with an ack. Never throws; failures come back as an error ack. */
  const call = useCallback(async <T,>(fn: (s: Sock) => Promise<Ack<T>>): Promise<Ack<T>> => {
    const s = sockRef.current;
    if (!s?.connected) return { ok: false, error: 'INVALID_PAYLOAD', message: 'offline' };
    try {
      return await fn(s);
    } catch {
      return { ok: false, error: 'INVALID_PAYLOAD', message: 'timeout' };
    }
  }, []);

  const join = useCallback(
    async (code: string, name: string, avatar: number) => {
      const res = await call<JoinResult>((s) => s.timeout(CALL_TIMEOUT_MS).emitWithAck('room:join', { code, name, avatar }));
      if (res.ok) adopt(res.data);
      return res;
    },
    [call, adopt],
  );

  const leave = useCallback(async () => {
    await call((s) => s.timeout(CALL_TIMEOUT_MS).emitWithAck('room:leave'));
    forget(null);
  }, [call, forget]);

  const setAvatar = useCallback(
    (avatar: number) => call((s) => s.timeout(CALL_TIMEOUT_MS).emitWithAck('player:setAvatar', { avatar })),
    [call],
  );
  const kick = useCallback(
    (playerId: string) => call((s) => s.timeout(CALL_TIMEOUT_MS).emitWithAck('host:kick', { playerId })),
    [call],
  );
  const configure = useCallback(
    (input: GameSetupInput) => call((s) => s.timeout(CALL_TIMEOUT_MS).emitWithAck('host:setup', input)),
    [call],
  );
  const start = useCallback(() => call((s) => s.timeout(CALL_TIMEOUT_MS).emitWithAck('host:start')), [call]);
  const backToLobby = useCallback(
    () => call((s) => s.timeout(CALL_TIMEOUT_MS).emitWithAck('host:backToLobby')),
    [call],
  );
  const useItem = useCallback(
    (payload: UseItemPayload) => call((s) => s.timeout(CALL_TIMEOUT_MS).emitWithAck('game:useItem', payload)),
    [call],
  );

  const submit = useCallback(async (word: string, targetId?: string): Promise<ClientSubmit> => {
    const s = sockRef.current;
    if (!s?.connected) return { ok: false, reason: 'OFFLINE' };
    try {
      return await s.timeout(CALL_TIMEOUT_MS).emitWithAck('game:submit', { word, ...(targetId ? { targetId } : {}) });
    } catch {
      return { ok: false, reason: 'OFFLINE' };
    }
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  return {
    conn,
    joined,
    snapshot,
    priv,
    playerId,
    events,
    notice,
    clearNotice,
    now,
    join,
    leave,
    setAvatar,
    kick,
    configure,
    start,
    backToLobby,
    useItem,
    submit,
  };
}

export type Game = ReturnType<typeof useGame>;
