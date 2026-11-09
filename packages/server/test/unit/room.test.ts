import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET, type RoomSnapshot } from '@wordparty/shared';
import { ManualClock } from '../../src/core/clock.js';
import { seededRng } from '../../src/core/rng.js';
import { RoomManager, generateRoomCode, normalizeRoomCode, type ManagerOutput } from '../../src/rooms/RoomManager.js';
import { enable } from '../helpers.js';

function setup(seed = 1) {
  const clock = new ManualClock();
  const log = { snapshots: [] as RoomSnapshot[], removed: [] as [string, string][], closed: [] as [string, string][] };
  const out: ManagerOutput = {
    snapshot: (_c, s) => log.snapshots.push(s),
    privateState: () => {},
    event: () => {},
    removed: (_c, id, reason) => log.removed.push([id, reason]),
    closed: (code, reason) => log.closed.push([code, reason]),
  };
  const manager = new RoomManager({ clock, rng: seededRng(seed), dict: enable(), countdownMs: 1000, roundEndMs: 1000, unsafeConfig: true }, out);
  const tick = (ms: number) => {
    const end = clock.now() + ms;
    while (clock.now() < end) {
      clock.advance(100);
      manager.tick(clock.now());
    }
  };
  return { clock, manager, log, tick };
}

const ok = <T>(r: { ok: true; data: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

describe('room codes', () => {
  it('are 4 characters without 0 O 1 I', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 2000; i++) {
      const code = generateRoomCode(rng);
      expect(code).toMatch(/^[A-Z2-9]{4}$/);
      expect(code).not.toMatch(/[01OI]/);
    }
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01OI]/);
  });

  it('are unique among live rooms', () => {
    const { manager } = setup();
    const codes = new Set<string>();
    for (let i = 0; i < 3000; i++) codes.add(manager.create().code);
    expect(codes.size).toBe(3000);
  });

  it('are normalized case-insensitively', () => {
    expect(normalizeRoomCode(' pq7k ')).toBe('PQ7K');
    expect(normalizeRoomCode('PQ0K')).toBeNull();
    expect(normalizeRoomCode('PQ7')).toBeNull();
  });
});

describe('Room membership', () => {
  it('validates nicknames, avatars, duplicates and capacity', () => {
    const { manager, clock } = setup();
    const room = manager.create();
    expect(room.join('', 0, clock.now())).toMatchObject({ ok: false, error: 'NICKNAME_INVALID' });
    expect(room.join('Kiki', 12, clock.now())).toMatchObject({ ok: false, error: 'AVATAR_INVALID' });
    ok(room.join('Kiki', 0, clock.now()));
    expect(room.join('kiki', 1, clock.now())).toMatchObject({ ok: false, error: 'NICKNAME_TAKEN' });
    for (let i = 2; i <= 10; i++) ok(room.join(`P${i}`, i % 12, clock.now()));
    expect(room.join('Extra', 0, clock.now())).toMatchObject({ ok: false, error: 'ROOM_FULL' });
  });

  it('first player is host; host controls are restricted', () => {
    const { manager, clock } = setup();
    const room = manager.create();
    const display = room.addDisplay(clock.now());
    const a = ok(room.join('A', 0, clock.now()));
    const b = ok(room.join('B', 1, clock.now()));
    expect(room.hostId).toBe(a.id);
    expect(room.start(b.id, clock.now())).toMatchObject({ ok: false, error: 'NOT_HOST' });
    expect(room.kick(b.id, a.id, clock.now())).toMatchObject({ ok: false, error: 'NOT_HOST' });
    expect(room.configure(display.id, { stages: [{ mode: 'bomb' }] })).toMatchObject({ ok: true });
    expect(room.kick(a.id, a.id, clock.now())).toMatchObject({ ok: false });
  });

  it('kick removes the player and revokes the token', () => {
    const { manager, clock, log } = setup();
    const room = manager.create();
    const a = ok(room.join('A', 0, clock.now()));
    const b = ok(room.join('B', 1, clock.now()));
    expect(room.kick(a.id, b.id, clock.now())).toEqual({ ok: true, data: null });
    expect(log.removed).toContainEqual([b.id, 'KICKED']);
    expect(room.players.map((p) => p.id)).toEqual([a.id]);
    expect(room.rejoin(b.token, clock.now())).toMatchObject({ ok: false, error: 'INVALID_TOKEN' });
  });

  it('holds a disconnected seat for 60 s, then frees it and migrates host', () => {
    const { manager, clock, tick, log } = setup();
    const room = manager.create();
    const a = ok(room.join('A', 0, clock.now()));
    const b = ok(room.join('B', 1, clock.now()));
    room.disconnect(a.id, clock.now());
    tick(59_000);
    expect(room.member(a.id)?.connected).toBe(false);
    expect(ok(room.rejoin(a.token, clock.now())).id).toBe(a.id);
    expect(room.member(a.id)?.connected).toBe(true);

    room.disconnect(a.id, clock.now());
    tick(60_100);
    expect(room.member(a.id)).toBeUndefined();
    expect(log.removed).toContainEqual([a.id, 'EXPIRED']);
    expect(room.hostId).toBe(b.id);
  });

  it('rejects joins mid-game but allows rejoin', () => {
    const { manager, clock, tick } = setup();
    const room = manager.create();
    const a = ok(room.join('A', 0, clock.now()));
    ok(room.join('B', 1, clock.now()));
    ok(room.start(a.id, clock.now()));
    expect(room.join('C', 2, clock.now())).toMatchObject({ ok: false, error: 'GAME_IN_PROGRESS' });
    room.disconnect(a.id, clock.now());
    tick(5000);
    expect(room.rejoin(a.token, clock.now())).toMatchObject({ ok: true });
    expect(room.snapshot(clock.now()).players.find((p) => p.id === a.id)?.connected).toBe(true);
  });

  it('needs 2 connected players to start', () => {
    const { manager, clock } = setup();
    const room = manager.create();
    const a = ok(room.join('A', 0, clock.now()));
    expect(room.start(a.id, clock.now())).toMatchObject({ ok: false, error: 'NOT_ENOUGH_PLAYERS' });
  });
});

describe('Room lifecycle', () => {
  it('is destroyed after 10 minutes without activity', () => {
    const { manager, clock, tick, log } = setup();
    const room = manager.create();
    ok(room.join('A', 0, clock.now()));
    tick(9 * 60_000);
    room.touch(clock.now());
    tick(9 * 60_000);
    expect(manager.get(room.code)).toBe(room);
    tick(60_100);
    expect(manager.get(room.code)).toBeUndefined();
    expect(log.closed).toEqual([[room.code, 'IDLE']]);
  });

  it('is destroyed when the last member is gone', () => {
    const { manager, clock, tick, log } = setup();
    const room = manager.create();
    const a = ok(room.join('A', 0, clock.now()));
    room.remove(a.id, clock.now());
    tick(100);
    expect(log.closed).toEqual([[room.code, 'EMPTY']]);
  });
});

describe('state machine', () => {
  it('LOBBY → COUNTDOWN → ROUND → ROUND_END → … → FINAL, with tournament totals', () => {
    const { manager, clock, tick } = setup();
    const room = manager.create();
    const a = ok(room.join('A', 0, clock.now()));
    ok(room.join('B', 1, clock.now()));
    ok(room.configure(a.id, { stages: [{ mode: 'flash', rounds: 2, config: { roundMs: 2000 } }, { mode: 'coopChain', config: { roundMs: 2000 } }] }));
    expect(room.engine.totalRounds).toBe(3);
    ok(room.start(a.id, clock.now()));

    const phases: string[] = [];
    let last = '';
    for (let i = 0; i < 200 && room.engine.phase !== 'FINAL'; i++) {
      tick(100);
      const s = room.snapshot(clock.now());
      const tag = `${s.phase}:${s.roundNumber}`;
      if (tag !== last) phases.push((last = tag));
    }
    expect(phases).toEqual([
      'COUNTDOWN:1',
      'ROUND:1',
      'ROUND_END:1',
      'COUNTDOWN:2',
      'ROUND:2',
      'ROUND_END:2',
      'COUNTDOWN:3',
      'ROUND:3',
      'ROUND_END:3',
      'FINAL:3',
    ]);
    const snap = room.snapshot(clock.now());
    expect(snap.final?.standings).toHaveLength(2);
    expect(snap.lastRound?.mode).toBe('coopChain');

    ok(room.backToLobby(a.id));
    expect(room.engine.phase).toBe('LOBBY');
  });

  it('broadcasts every tick during a round and only on change in the lobby', () => {
    const { manager, clock, tick, log } = setup();
    const room = manager.create();
    const a = ok(room.join('A', 0, clock.now()));
    ok(room.join('B', 1, clock.now()));
    tick(1000);
    const lobbyCount = log.snapshots.length;
    tick(1000);
    expect(log.snapshots.length).toBe(lobbyCount);
    ok(room.start(a.id, clock.now()));
    tick(1000);
    expect(log.snapshots.length - lobbyCount).toBe(10);
  });
});
