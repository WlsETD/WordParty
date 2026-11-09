import { describe, expect, it } from 'vitest';
import { EngineHarness, findWord } from '../../helpers.js';

const setup = (over: Record<string, number> = {}) => ({
  stages: [{ mode: 'coopChain' as const, config: { target: 6, roundMs: 60_000, ...over } }],
});

function add(h: EngineHarness, p: string) {
  const st = h.state('coopChain');
  const w = findWord(h.dict, st.requiredLetter, { used: [st.currentWord, ...st.chain.map((c) => c.word)], minLength: 4 });
  return h.submit(p, w);
}

describe('Co-op Long Chain 合作長龍', () => {
  it('anyone may extend the chain, but not twice in a row', () => {
    const h = new EngineHarness(['A', 'B', 'C']).startGame(setup());
    expect(add(h, 'A')).toMatchObject({ ok: true, points: 3 });
    expect(add(h, 'A')).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
    expect(add(h, 'C')).toMatchObject({ ok: true });
    expect(add(h, 'A')).toMatchObject({ ok: true });
    const st = h.state('coopChain');
    expect(st).toMatchObject({ count: 3, lastPlayerId: 'A', contributions: { A: 2, B: 0, C: 1 }, milestones: [2, 4] });
  });

  it('milestones and completion give everyone a bonus', () => {
    const h = new EngineHarness(['A', 'B', 'C']).startGame(setup());
    const order = ['A', 'B', 'A', 'B', 'A', 'B'];
    for (const p of order) expect(add(h, p)).toMatchObject({ ok: true });
    expect(h.eventsOf('MILESTONE').map((e) => e.count)).toEqual([2, 4]);
    expect(h.eventsOf('CHAIN_COMPLETE')).toHaveLength(1);
    h.advance(100);
    const pts = Object.fromEntries(h.engine.lastRound!.scores.map((s) => [s.playerId, s.points]));
    // bonus = 2 milestones × 5 + 20 = 30
    expect(pts).toEqual({ A: 9 + 30, B: 9 + 30, C: 30 });
  });

  it('fails without the completion bonus when time runs out', () => {
    const h = new EngineHarness(['A', 'B']).startGame(setup({ roundMs: 5000 }));
    add(h, 'A');
    add(h, 'B');
    h.advance(5000);
    const pts = Object.fromEntries(h.engine.lastRound!.scores.map((s) => [s.playerId, s.points]));
    expect(pts).toEqual({ A: 3 + 5, B: 3 + 5 });
    expect(h.state('coopChain').completed).toBe(false);
  });
});
