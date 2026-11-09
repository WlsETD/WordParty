import { describe, expect, it } from 'vitest';
import { BombMode, fuseStageFor } from '../../../src/modes/bomb.js';
import { EngineHarness, findWord } from '../../helpers.js';

const cfg = (over: Record<string, number> = {}) => ({
  stages: [{ mode: 'bomb' as const, config: { lives: 2, fuseMinMs: 10_000, fuseMaxMs: 10_000, minTurnMs: 3000, explosionPauseMs: 2000, ...over } }],
});

function bomb(h: EngineHarness) {
  return h.engine.mode as BombMode;
}

/** The holder answers correctly and passes to `to` (or a random allowed player). */
function pass(h: EngineHarness, to?: string, used: string[] = []) {
  const st = h.state('bomb');
  const w = findWord(h.dict, st.requiredLetter, { used: [...used, st.currentWord], minLength: 4 });
  used.push(w);
  return h.submit(st.holderId!, w, to);
}

describe('Bomb Pass 炸彈傳遞', () => {
  it('maps the remaining fuse to art stages', () => {
    expect([1, 0.7, 0.4, 0.2, 0.05, 0].map(fuseStageFor)).toEqual(['idle', 'fuse1', 'fuse2', 'fuse3', 'critical', 'critical']);
  });

  it('only the holder may answer, and cannot pass to self or straight back', () => {
    const h = new EngineHarness(['A', 'B', 'C']).startGame(cfg());
    const holder = h.state('bomb').holderId!;
    const others = ['A', 'B', 'C'].filter((p) => p !== holder);
    expect(h.submit(others[0], 'whatever')).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
    expect(pass(h, holder)).toEqual({ ok: false, reason: 'INVALID_TARGET' });

    expect(pass(h, others[0])).toMatchObject({ ok: true, points: 2 });
    expect(h.state('bomb')).toMatchObject({ holderId: others[0], passedFromId: holder });
    // others[0] cannot throw it back to holder.
    expect(pass(h, holder)).toEqual({ ok: false, reason: 'INVALID_TARGET' });
    expect(pass(h, others[1])).toMatchObject({ ok: true });
    expect(h.eventsOf('BOMB_PASSED').map((e) => [e.from, e.to])).toEqual([
      [holder, others[0]],
      [others[0], others[1]],
    ]);
  });

  it('with two players left, passing back is allowed', () => {
    const h = new EngineHarness(['A', 'B']).startGame(cfg());
    const holder = h.state('bomb').holderId!;
    const other = holder === 'A' ? 'B' : 'A';
    expect(pass(h, other)).toMatchObject({ ok: true });
    expect(pass(h, holder)).toMatchObject({ ok: true });
  });

  it('answers must chain from the current word', () => {
    const h = new EngineHarness().startGame(cfg());
    const st = h.state('bomb');
    const wrong = findWord(h.dict, st.requiredLetter === 'a' ? 'b' : 'a');
    expect(h.submit(st.holderId!, wrong)).toEqual({ ok: false, reason: 'WRONG_START' });
  });

  it('the fuse is shared across passes and explodes on the current holder', () => {
    const h = new EngineHarness(['A', 'B', 'C']).startGame(cfg());
    const start = h.now;
    expect(bomb(h).fuseEnd).toBe(start + 10_000);
    h.advance(2000);
    pass(h);
    // Passing does not reset the fuse.
    expect(bomb(h).fuseEnd).toBe(start + 10_000);
    const victim = h.state('bomb').holderId!;
    h.advance(8000);
    expect(h.eventsOf('BOMB_EXPLODED')).toEqual([expect.objectContaining({ playerId: victim, livesLeft: 1, shielded: false })]);
    expect(h.state('bomb')).toMatchObject({ holderId: null, lives: { [victim]: 1 } });
    // After the pause, the victim restarts with a fresh fuse and word.
    h.advance(2000);
    expect(h.state('bomb').holderId).toBe(victim);
  });

  it('every holder gets at least 3 seconds', () => {
    const h = new EngineHarness(['A', 'B', 'C']).startGame(cfg());
    const start = h.now;
    h.advance(9000);
    pass(h);
    // Fuse would end at start+10000, but the new holder is guaranteed until now+3000.
    expect(bomb(h).fuseEnd).toBe(start + 12_000);
  });

  it('eliminates players at 0 lives; last alive wins with survival bonus', () => {
    const h = new EngineHarness(['A', 'B', 'C']).startGame(cfg({ lives: 1 }));
    const r = h.finishRound();
    const order = h.state('bomb').eliminatedOrder;
    expect(order).toHaveLength(2);
    expect(h.eventsOf('PLAYER_ELIMINATED').map((e) => e.playerId)).toEqual(order);
    const winner = ['A', 'B', 'C'].find((p) => !order.includes(p))!;
    const pts = Object.fromEntries(r.scores.map((s) => [s.playerId, s.points]));
    expect(pts[order[0]]).toBe(0);
    expect(pts[order[1]]).toBe(10);
    expect(pts[winner]).toBe(20);
    expect(h.engine.playerStatus(order[0])).toMatchObject({ eliminated: true, lives: 0 });
  });

  it('a shield blocks one explosion', () => {
    const h = new EngineHarness(['A', 'B']).startGame({ ...cfg({ lives: 1 }), modifiers: { itemsEnabled: true } });
    const holder = h.state('bomb').holderId!;
    expect(h.engine.useItem(holder, { item: 'shield' }, h.now)).toEqual({ ok: true, data: null });
    h.advance(10_000);
    expect(h.eventsOf('BOMB_EXPLODED')[0]).toMatchObject({ playerId: holder, shielded: true, livesLeft: 1 });
    expect(h.eventsOf('SHIELD_BLOCKED')).toHaveLength(1);
    expect(h.engine.phase).toBe('ROUND');
  });

  it('hourglass shortens the holder fuse but never below the minimum turn', () => {
    const h = new EngineHarness(['A', 'B', 'C']).startGame({ ...cfg(), modifiers: { itemsEnabled: true } });
    const holder = h.state('bomb').holderId!;
    const thrower = ['A', 'B', 'C'].find((p) => p !== holder)!;
    const before = bomb(h).fuseEnd;
    expect(h.engine.useItem(thrower, { item: 'hourglass', targetId: holder }, h.now)).toMatchObject({ ok: true });
    expect(bomb(h).fuseEnd).toBe(before - 3000);
  });

  it('a holder who leaves is skipped without an explosion', () => {
    const h = new EngineHarness(['A', 'B', 'C']).startGame(cfg());
    const holder = h.state('bomb').holderId!;
    h.engine.playerLeft(holder, h.now);
    const st = h.state('bomb');
    expect(st.holderId).not.toBe(holder);
    expect(st.holderId).not.toBeNull();
    expect(h.eventsOf('BOMB_EXPLODED')).toHaveLength(0);
  });
});
