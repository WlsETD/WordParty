import { describe, expect, it } from 'vitest';
import { EngineHarness, findWord } from '../../helpers.js';

const setup = { stages: [{ mode: 'lastStand' as const, config: { heatMs: 5000, heatGapMs: 1000 } }] };

function word(h: EngineHarness, len: number, used: string[] = []) {
  const w = findWord(h.dict, h.state('lastStand').startLetter, { minLength: len, maxLength: len, used, chainable: false });
  used.push(w);
  return w;
}

describe('Last-place Elimination 末位淘汰', () => {
  it('eliminates the lowest heat score each heat until one remains', () => {
    const h = new EngineHarness(['A', 'B', 'C']).startGame(setup);
    // Heat 1: A 5, B 4, C 0 → C out.
    const usedA: string[] = [];
    expect(h.submit('A', word(h, 5, usedA))).toMatchObject({ ok: true, points: 5 });
    expect(h.submit('B', word(h, 4))).toMatchObject({ ok: true, points: 4 });
    expect(h.state('lastStand').dangerId).toBe('C');
    h.advance(5000);
    let st = h.state('lastStand');
    expect(st).toMatchObject({ heat: 1, heatDeadline: null, lastEliminatedId: 'C', eliminatedOrder: ['C'], alive: ['A', 'B'] });
    expect(h.submit('A', 'anything')).toEqual({ ok: false, reason: 'ROUND_NOT_ACTIVE' });
    expect(h.submit('C', 'anything')).toEqual({ ok: false, reason: 'ELIMINATED' });

    // Heat 2 after the gap, new letter, scores reset.
    h.advance(1000);
    st = h.state('lastStand');
    expect(st.heat).toBe(2);
    expect(st.heatScores).toEqual({ A: 0, B: 0 });
    h.submit('B', word(h, 6));
    h.submit('A', word(h, 3));
    h.advance(5000);
    expect(h.engine.phase).toBe('ROUND_END');

    const pts = Object.fromEntries(h.engine.lastRound!.scores.map((s) => [s.playerId, s.points]));
    // letters + 10 per player outlasted
    expect(pts).toEqual({ B: 4 + 6 + 20, A: 5 + 3 + 10, C: 0 });
    expect(h.eventsOf('HEAT_END').map((e) => e.eliminatedId)).toEqual(['C', 'A']);
  });

  it('players do not compete for words, but cannot repeat their own', () => {
    const h = new EngineHarness(['A', 'B']).startGame(setup);
    const w = word(h, 5);
    expect(h.submit('A', w)).toMatchObject({ ok: true });
    expect(h.submit('B', w)).toMatchObject({ ok: true });
    expect(h.submit('A', w)).toEqual({ ok: false, reason: 'ALREADY_USED' });
  });

  it('on a score tie the player whose last word came later is eliminated', () => {
    const h = new EngineHarness(['A', 'B', 'C']).startGame(setup);
    h.submit('C', word(h, 9));
    h.submit('A', word(h, 5));
    h.advance(500);
    h.submit('B', word(h, 5));
    h.advance(4500);
    expect(h.state('lastStand').eliminatedOrder).toEqual(['B']);
  });

  it('a shield saves the lowest player once; the next lowest goes instead', () => {
    const h = new EngineHarness(['A', 'B', 'C']).startGame({ ...setup, modifiers: { itemsEnabled: true } });
    h.submit('A', word(h, 8));
    h.submit('B', word(h, 4));
    expect(h.engine.useItem('C', { item: 'shield' }, h.now)).toMatchObject({ ok: true });
    h.advance(5000);
    expect(h.state('lastStand').eliminatedOrder).toEqual(['B']);
    expect(h.eventsOf('SHIELD_BLOCKED')).toEqual([expect.objectContaining({ playerId: 'C' })]);
  });

  it('hourglass shortens one player’s heat', () => {
    const h = new EngineHarness(['A', 'B']).startGame({ ...setup, modifiers: { itemsEnabled: true } });
    expect(h.engine.useItem('A', { item: 'hourglass', targetId: 'B' }, h.now)).toMatchObject({ ok: true });
    expect(h.engine.privateParts('B').personalDeadline).toBe(h.state('lastStand').heatDeadline! - 3000);
    h.advance(2100);
    expect(h.submit('B', word(h, 4))).toEqual({ ok: false, reason: 'ROUND_NOT_ACTIVE' });
    expect(h.submit('A', word(h, 4))).toMatchObject({ ok: true });
  });
});
