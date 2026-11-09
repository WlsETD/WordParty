import { describe, expect, it } from 'vitest';
import { comboMultiplier, flameTier } from '../../../src/modes/precise.js';
import { EngineHarness, findWord } from '../../helpers.js';

const setup = { stages: [{ mode: 'precise' as const, config: { roundMs: 20_000, maxErrors: 3, wrongPenalty: 2 } }] };

/** Plays one valid word in the player's own lane. */
function play(h: EngineHarness, p: string, used: string[]) {
  const lane = h.state('precise').lanes.find((l) => l.playerId === p)!;
  const w = findWord(h.dict, lane.requiredLetter, { used: [...used, lane.lastWord], minLength: 4, maxLength: 4 });
  used.push(w);
  return { word: w, res: h.submit(p, w) };
}

describe('Precise 精準接龍', () => {
  it('combo multiplier and flame tiers change at 3 and 6', () => {
    expect([1, 2, 3, 5, 6, 9].map(comboMultiplier)).toEqual([1, 1, 1.5, 1.5, 2, 2]);
    expect([0, 1, 2, 3, 5, 6].map(flameTier)).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it('each player chains from their own last word with combo bonus', () => {
    const h = new EngineHarness().startGame(setup);
    const start = h.state('precise').startWord;
    const used: string[] = [];
    const points: number[] = [];
    for (let i = 0; i < 6; i++) {
      const { res } = play(h, 'A', used);
      expect(res.ok).toBe(true);
      if (res.ok) points.push(res.points);
    }
    // 4-letter words: ×1, ×1, ×1.5, ×1.5, ×1.5, ×2
    expect(points).toEqual([4, 4, 6, 6, 6, 8]);
    const lanes = h.state('precise').lanes;
    expect(lanes.find((l) => l.playerId === 'A')).toMatchObject({ count: 6, combo: 6, flameTier: 3, score: 34 });
    // B's lane is untouched and still starts from the start word.
    expect(lanes.find((l) => l.playerId === 'B')).toMatchObject({ lastWord: start, count: 0 });
  });

  it('errors and repeats cost points, reset combo, and 3 errors put you out', () => {
    const h = new EngineHarness().startGame(setup);
    const used: string[] = [];
    const first = play(h, 'A', used);
    play(h, 'A', used);
    // A non-word, then a wrong start letter, then a too-short word: three errors.
    expect(h.submit('A', 'zzzzqx')).toMatchObject({ ok: false, penalty: 2 });
    expect(h.state('precise').lanes[0]).toMatchObject({ combo: 0, errors: 1, score: 8 - 2 });
    expect(h.submit('A', first.word)).toMatchObject({ ok: false, penalty: 2 });
    expect(h.submit('A', 'qqq')).toMatchObject({ ok: false, penalty: 2 });
    expect(h.state('precise').lanes[0]).toMatchObject({ errors: 3, out: true, score: 2 });
    expect(h.eventsOf('PLAYER_ELIMINATED')).toEqual([expect.objectContaining({ playerId: 'A' })]);
    expect(h.submit('A', 'anything')).toEqual({ ok: false, reason: 'ELIMINATED' });
  });

  it('rejects a word repeated in your own lane with ALREADY_USED', () => {
    const h = new EngineHarness().startGame(setup);
    // Build a lane that loops back to its own letter: find w1 with w1[0] === last letter of w1.
    const lane = h.state('precise').lanes[0];
    const loop = h.dict.wordsStartingWith(lane.requiredLetter).find((w) => w.length >= 4 && w.endsWith(lane.requiredLetter))!;
    expect(h.submit('A', loop)).toMatchObject({ ok: true });
    expect(h.submit('A', loop)).toEqual({ ok: false, reason: 'ALREADY_USED', penalty: 2 });
  });

  it('the round ends early when everyone is out', () => {
    const h = new EngineHarness(['A', 'B']).startGame(setup);
    for (const p of ['A', 'B']) for (let i = 0; i < 3; i++) h.submit(p, 'zzzzqx');
    h.advance(100);
    expect(h.engine.phase).toBe('ROUND_END');
    const r = h.engine.lastRound!;
    expect(r.scores.map((s) => s.points)).toEqual([-6, -6]);
    expect(r.mvpId).toBeNull();
  });
});
