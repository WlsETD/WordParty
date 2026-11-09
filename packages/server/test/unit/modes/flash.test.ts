import { describe, expect, it } from 'vitest';
import { EngineHarness, findWord } from '../../helpers.js';

const setup = { stages: [{ mode: 'flash' as const, config: { roundMs: 10_000 } }] };

describe('Flash 閃電搶答', () => {
  it('scores word length; each word scores once, first come first served', () => {
    const h = new EngineHarness().startGame(setup);
    const { startLetter } = h.state('flash');
    const w1 = findWord(h.dict, startLetter, { minLength: 5 });
    const w2 = findWord(h.dict, startLetter, { used: [w1], minLength: 4 });

    expect(h.submit('A', w1)).toEqual({ ok: true, word: w1, points: w1.length });
    // Same word in the same tick: the first processed wins.
    expect(h.submit('B', w1)).toEqual({ ok: false, reason: 'ALREADY_USED' });
    expect(h.submit('B', w2.toUpperCase())).toMatchObject({ ok: true, points: w2.length });

    const st = h.state('flash');
    expect(st.grabbed.map((g) => [g.playerId, g.word])).toEqual([
      ['A', w1],
      ['B', w2],
    ]);
    expect(st.scores).toMatchObject({ A: w1.length, B: w2.length, C: 0 });

    const result = h.finishRound();
    expect(result.mode).toBe('flash');
    expect(result.scores[0]).toMatchObject({ playerId: 'A', points: w1.length, words: 1, longestWord: w1 });
    expect(result.mvpId).toBe('A');
  });

  it('rejects words with the wrong start letter or not in the dictionary', () => {
    const h = new EngineHarness().startGame(setup);
    const { startLetter } = h.state('flash');
    const other = startLetter === 'a' ? 'b' : 'a';
    expect(h.submit('A', findWord(h.dict, other))).toEqual({ ok: false, reason: 'WRONG_START' });
    expect(h.submit('A', `${startLetter}qzxqzx`)).toEqual({ ok: false, reason: 'NOT_IN_DICT' });
    expect(h.eventsOf('WORD_REJECTED')).toHaveLength(2);
  });

  it('ends at the deadline and refuses late words', () => {
    const h = new EngineHarness().startGame(setup);
    const { startLetter } = h.state('flash');
    h.advance(10_000);
    expect(h.engine.phase).toBe('ROUND_END');
    expect(h.submit('A', findWord(h.dict, startLetter))).toEqual({ ok: false, reason: 'ROUND_NOT_ACTIVE' });
  });

  it('applies the min-length and banned-letter modifiers', () => {
    const h = new EngineHarness().startGame({ ...setup, modifiers: { minLength: 6, bannedLetters: ['e'] } });
    const { startLetter } = h.state('flash');
    expect(startLetter).not.toBe('e');
    expect(h.submit('A', findWord(h.dict, startLetter, { maxLength: 5, minLength: 3 }))).toEqual({ ok: false, reason: 'TOO_SHORT' });
    const withE = h.dict.wordsStartingWith(startLetter).find((w) => w.length >= 6 && w.includes('e'))!;
    expect(h.submit('A', withE)).toEqual({ ok: false, reason: 'BANNED_LETTER' });
    expect(h.submit('A', findWord(h.dict, startLetter, { minLength: 6, maxLength: 9, avoid: ['e'] }))).toMatchObject({ ok: true });
  });
});
