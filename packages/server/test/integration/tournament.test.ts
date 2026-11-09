import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameSetup, GameSetupInput, RoomSnapshot } from '@wordparty/shared';
import { createGameServer, type GameServer } from '../../src/transport/gateway.js';
import { enable } from '../helpers.js';
import { Bot, connect, unwrap } from './bot.js';

const dict = enable();
let server: GameServer;
let url: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  server = createGameServer({ dict, countdownMs: 300, roundEndMs: 300, unsafeConfig: true, graceMs: 5_000 });
  const port = await server.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

/** A display creates the room; `n` bots join. The first bot is host. */
async function party(n: number) {
  const display = await new Bot(url, 'TV', dict).connect();
  const { code } = await display.create('display');
  const bots: Bot[] = [];
  for (let i = 0; i < n; i++) {
    const bot = await new Bot(url, `Bot${i + 1}`, dict, i % 12).connect();
    await bot.join(code);
    bots.push(bot);
  }
  return { display, code, bots };
}

/** Every mode, one round each, with short timings so the whole game runs in seconds. */
const TOURNAMENT: GameSetupInput = {
  stages: [
    { mode: 'flash', config: { roundMs: 2500 } },
    { mode: 'precise', config: { roundMs: 2500, maxErrors: 3 } },
    { mode: 'bomb', config: { lives: 1, fuseMinMs: 600, fuseMaxMs: 1200, minTurnMs: 200, explosionPauseMs: 200 } },
    { mode: 'lastStand', config: { heatMs: 900, heatGapMs: 200 } },
    { mode: 'teamRelay', config: { turnMs: 1500, targetScore: 6, roundMs: 8000 } },
    { mode: 'coopChain', config: { target: 10, roundMs: 8000 } },
    { mode: 'trapChain', config: { turnMs: 1500, lives: 1, trapCount: 2, roundMs: 6000 } },
  ],
  modifiers: { itemsEnabled: true },
};

describe('integration: 10-player tournament', () => {
  it('plays all 7 modes end to end, with a disconnect + reconnect mid-game', async () => {
    const { display, code, bots } = await party(10);
    const host = bots[0];
    expect(display.snapshot?.players).toHaveLength(10);
    expect(host.snapshot?.hostId).toBe(host.playerId);

    // Non-hosts cannot start; host sets up and starts.
    expect(await bots[1].socket.timeout(5000).emitWithAck('host:start')).toMatchObject({ ok: false, error: 'NOT_HOST' });
    const setup = unwrap<GameSetup>(await host.socket.timeout(5000).emitWithAck('host:setup', TOURNAMENT));
    expect(setup.stages.map((s) => s.mode)).toEqual(['flash', 'precise', 'bomb', 'lastStand', 'teamRelay', 'coopChain', 'trapChain']);
    for (const b of bots) b.autoplay = true;
    unwrap(await host.socket.timeout(5000).emitWithAck('host:start'));

    // Record every round result the display sees.
    const rounds = new Map<number, RoomSnapshot['lastRound']>();
    display.socket.on('state:snapshot', (s) => {
      if (s.phase === 'ROUND_END' && s.lastRound) rounds.set(s.roundNumber, s.lastRound);
    });

    // During Bomb Pass, Bot5 drops and comes back on a new socket with its token.
    const dropper = bots[4];
    await display.waitFor((s) => s.phase === 'ROUND' && s.modeState?.mode === 'bomb', 60_000);
    const { playerId, token } = dropper;
    dropper.disconnect();
    const seen = await display.waitFor((s) => s.players.find((p) => p.id === playerId)?.connected === false);
    expect(seen.phase).not.toBe('LOBBY');
    await sleep(300);
    const back = await new Bot(url, dropper.name, dict).connect();
    const rejoined = await back.rejoin(code, token);
    expect(rejoined.playerId).toBe(playerId);
    expect(rejoined.role).toBe('player');
    await display.waitFor((s) => s.players.find((p) => p.id === playerId)?.connected === true);
    back.autoplay = true;
    bots[4] = back;
    // A brand-new player cannot join while the game runs.
    const late = await new Bot(url, 'Late', dict).connect();
    await expect(late.join(code)).rejects.toThrow('GAME_IN_PROGRESS');
    late.disconnect();

    const final = await display.waitFor((s) => s.phase === 'FINAL', 120_000);
    for (const b of bots) b.autoplay = false;

    // Every round was played, in order.
    expect(final.totalRounds).toBe(7);
    expect([...rounds.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect([...rounds.values()].map((r) => r!.mode)).toEqual(setup.stages.map((s) => s.mode));

    // Final standings = sum of round scores, for all 10 players, ranked.
    const standings = final.final!.standings;
    expect(standings).toHaveLength(10);
    for (const st of standings) {
      const sum = [...rounds.values()].reduce((n, r) => n + (r!.scores.find((x) => x.playerId === st.playerId)?.points ?? 0), 0);
      expect(st.score).toBe(sum);
      expect(final.players.find((p) => p.id === st.playerId)?.score).toBe(sum);
    }
    for (let i = 1; i < standings.length; i++) expect(standings[i - 1].score).toBeGreaterThanOrEqual(standings[i].score);
    expect(standings[0].rank).toBe(1);
    expect(standings.reduce((n, s) => n + s.stats.wordsAccepted, 0)).toBeGreaterThan(20);

    // Bots really played: words were accepted in every mode, bombs exploded, players were eliminated.
    const events = display.events;
    expect(events.filter((e) => e.type === 'WORD_ACCEPTED').length).toBeGreaterThan(30);
    expect(events.filter((e) => e.type === 'BOMB_EXPLODED').length).toBeGreaterThanOrEqual(9);
    expect(events.filter((e) => e.type === 'PLAYER_ELIMINATED').length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'HEAT_END')).toBe(true);

    // The reconnected player is still in the standings with the same id.
    expect(standings.some((s) => s.playerId === playerId)).toBe(true);

    // Snapshot versions only go up.
    const versions = display.snapshots.map((s) => s.version);
    for (let i = 1; i < versions.length; i++) expect(versions[i]).toBeGreaterThan(versions[i - 1]);

    // Back to the lobby, scores reset.
    unwrap(await display.socket.timeout(5000).emitWithAck('host:backToLobby'));
    const lobby = await display.waitFor((s) => s.phase === 'LOBBY');
    expect(lobby.players.every((p) => p.score === 0)).toBe(true);

    for (const b of [display, ...bots]) b.disconnect();
  }, 180_000);
});

describe('integration: simultaneous answers', () => {
  it('10 players sending the same word at once: exactly one scores', async () => {
    const { display, bots } = await party(10);
    const host = bots[0];
    unwrap(await host.socket.timeout(5000).emitWithAck('host:setup', { stages: [{ mode: 'flash', config: { roundMs: 5000 } }] }));
    unwrap(await host.socket.timeout(5000).emitWithAck('host:start'));
    const s = await display.waitFor((x) => x.phase === 'ROUND');
    const letter = (s.modeState as { startLetter: string }).startLetter;
    const contested = dict.wordsStartingWith(letter).find((w) => w.length === 6)!;

    const results = await Promise.all(bots.map((b) => b.submit(contested)));
    const winners = results.filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === 'ALREADY_USED')).toHaveLength(9);

    // Two different words at the same instant both score.
    const [w1, w2] = dict.wordsStartingWith(letter).filter((w) => w.length === 5 && w !== contested).slice(0, 2);
    const both = await Promise.all([bots[1].submit(w1), bots[2].submit(w2)]);
    expect(both.every((r) => r.ok)).toBe(true);

    const after = await display.waitFor((x) => x.modeState?.mode === 'flash' && x.modeState.grabbed.length === 3);
    if (after.modeState?.mode === 'flash') expect(after.modeState.grabbed.filter((g) => g.word === contested)).toHaveLength(1);
    for (const b of [display, ...bots]) b.disconnect();
  });

  it('bomb holder races: only the holder can answer, once', async () => {
    const { display, bots } = await party(3);
    unwrap(
      await bots[0].socket.timeout(5000).emitWithAck('host:setup', {
        stages: [{ mode: 'bomb', config: { lives: 1, fuseMinMs: 20_000, fuseMaxMs: 20_000, minTurnMs: 3000 } }],
      }),
    );
    unwrap(await bots[0].socket.timeout(5000).emitWithAck('host:start'));
    const s = await display.waitFor((x) => x.phase === 'ROUND');
    const m = s.modeState!;
    if (m.mode !== 'bomb') throw new Error('expected bomb');
    const words = dict.wordsStartingWith(m.requiredLetter).filter((w) => w.length >= 4 && w !== m.currentWord).slice(0, 3);
    const results = await Promise.all(bots.map((b, i) => b.submit(words[i])));
    const holderIdx = bots.findIndex((b) => b.playerId === m.holderId);
    results.forEach((r, i) => {
      if (i === holderIdx) expect(r.ok).toBe(true);
      // Either it was not their turn, or the bomb reached them first and the letter had changed.
      else expect(r).toEqual({ ok: false, reason: expect.stringMatching(/^(NOT_YOUR_TURN|WRONG_START)$/) });
    });
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const b of [display, ...bots]) b.disconnect();
  });
});

describe('integration: rooms and abuse protection', () => {
  it('rejects bad joins and lets the host kick', async () => {
    const { display, code, bots } = await party(2);
    const c = await connect(url);
    expect(await c.timeout(5000).emitWithAck('room:join', { code: 'ZZZZ', name: 'x', avatar: 0 })).toMatchObject({ ok: false, error: 'ROOM_NOT_FOUND' });
    expect(await c.timeout(5000).emitWithAck('room:join', { code, name: '<b>hi</b>', avatar: 0 })).toMatchObject({ ok: false, error: 'NICKNAME_INVALID' });
    expect(await c.timeout(5000).emitWithAck('room:join', { code, name: 'Bot1', avatar: 0 })).toMatchObject({ ok: false, error: 'NICKNAME_TAKEN' });
    expect(await c.timeout(5000).emitWithAck('room:join', { code: code.toLowerCase(), name: 'Neo', avatar: 3 })).toMatchObject({ ok: true });

    const kicked = new Promise((resolve) => bots[1].socket.once('room:kicked', resolve));
    expect(await bots[0].socket.timeout(5000).emitWithAck('host:kick', { playerId: bots[1].playerId! })).toEqual({ ok: true, data: null });
    expect(await kicked).toEqual({ reason: 'KICKED' });
    const s = await display.waitFor((x) => x.players.length === 2);
    expect(s.players.map((p) => p.name)).toEqual(['Bot1', 'Neo']);
    // The kicked socket is no longer in the room.
    expect(await bots[1].submit('hello')).toEqual({ ok: false, reason: 'ROUND_NOT_ACTIVE' });
    c.disconnect();
    for (const b of [display, ...bots]) b.disconnect();
  });

  it('rate-limits a flooding connection', async () => {
    const c = await connect(url);
    const res = await Promise.all(Array.from({ length: 40 }, (_, i) => c.timeout(5000).emitWithAck('time:ping', { t0: i })));
    const limited = res.filter((r) => 'ok' in r && (r as { ok: boolean }).ok === false);
    expect(limited.length).toBeGreaterThan(10);
    expect(res[0]).toMatchObject({ t0: 0, serverNow: expect.any(Number) });
    c.disconnect();
  });

  it('a replaced seat kicks the old socket', async () => {
    const { display, code, bots } = await party(2);
    const replaced = new Promise((resolve) => bots[1].socket.once('room:kicked', resolve));
    const twin = await new Bot(url, 'twin', dict).connect();
    await twin.rejoin(code, bots[1].token);
    expect(await replaced).toEqual({ reason: 'REPLACED' });
    for (const b of [display, twin, ...bots]) b.disconnect();
  });
});
