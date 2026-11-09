import { describe, expect, it } from 'vitest';
import { ITEM_COOLDOWN_MS } from '@wordparty/shared';
import { EngineHarness, findWord } from '../helpers.js';

const flash = (itemsEnabled = true) => ({ stages: [{ mode: 'flash' as const, config: { roundMs: 60_000 } }], modifiers: { itemsEnabled } });

describe('items', () => {
  it('are handed out per round only when enabled, filtered by mode', () => {
    expect(new EngineHarness().startGame(flash(false)).engine.privateParts('A').items).toEqual([]);
    const h = new EngineHarness().startGame(flash());
    expect(h.engine.privateParts('A').items.map((i) => [i.type, i.count])).toEqual([
      ['hourglass', 1],
      ['lock', 1],
      ['star2x', 1],
    ]);
    expect(h.engine.useItem('A', { item: 'shield' }, h.now)).toMatchObject({ ok: false, error: 'ITEM_UNAVAILABLE' });
  });

  it('star ×2 doubles the next accepted word only', () => {
    const h = new EngineHarness().startGame(flash());
    const letter = h.state('flash').startLetter;
    expect(h.engine.useItem('A', { item: 'star2x' }, h.now)).toEqual({ ok: true, data: null });
    expect(h.engine.privateParts('A').doubleActive).toBe(true);
    const w1 = findWord(h.dict, letter, { minLength: 5, maxLength: 5 });
    const w2 = findWord(h.dict, letter, { minLength: 5, maxLength: 5, used: [w1] });
    expect(h.submit('A', w1)).toMatchObject({ points: 10 });
    expect(h.submit('A', w2)).toMatchObject({ points: 5 });
    expect(h.engine.privateParts('A').doubleActive).toBe(false);
  });

  it('lock blocks a letter for the target’s next word (not as first letter)', () => {
    const h = new EngineHarness().startGame(flash());
    const letter = h.state('flash').startLetter;
    const blocked = letter === 'e' ? 'a' : 'e';
    expect(h.engine.useItem('A', { item: 'lock', targetId: 'B', letter: blocked }, h.now)).toMatchObject({ ok: true });
    expect(h.engine.privateParts('B').blockedLetters).toEqual([blocked]);
    const bad = h.dict.wordsStartingWith(letter).find((w) => w.length >= 4 && w.slice(1).includes(blocked))!;
    expect(h.submit('B', bad)).toEqual({ ok: false, reason: 'BLOCKED_LETTER' });
    const good = findWord(h.dict, letter, { avoid: [blocked], minLength: 4 });
    expect(h.submit('B', good)).toMatchObject({ ok: true });
    // Consumed after one accepted word.
    expect(h.engine.privateParts('B').blockedLetters).toEqual([]);
    expect(h.eventsOf('ITEM_USED')).toEqual([expect.objectContaining({ by: 'A', item: 'lock', targetId: 'B', letter: blocked })]);
  });

  it('validates targets, letters, counts and cooldowns', () => {
    const h = new EngineHarness().startGame(flash());
    expect(h.engine.useItem('A', { item: 'lock', targetId: 'A', letter: 'e' }, h.now)).toMatchObject({ error: 'INVALID_TARGET' });
    expect(h.engine.useItem('A', { item: 'lock', targetId: 'Z', letter: 'e' }, h.now)).toMatchObject({ error: 'INVALID_TARGET' });
    expect(h.engine.useItem('A', { item: 'lock', targetId: 'B', letter: 'ee' }, h.now)).toMatchObject({ error: 'INVALID_PAYLOAD' });
    expect(h.engine.useItem('A', { item: 'hourglass', targetId: 'B' }, h.now)).toMatchObject({ ok: true });
    expect(h.engine.useItem('A', { item: 'star2x' }, h.now)).toMatchObject({ error: 'ITEM_COOLDOWN' });
    h.advance(ITEM_COOLDOWN_MS);
    expect(h.engine.useItem('A', { item: 'hourglass', targetId: 'C' }, h.now)).toMatchObject({ error: 'ITEM_UNAVAILABLE' });
    expect(h.engine.useItem('A', { item: 'star2x' }, h.now)).toMatchObject({ ok: true });
  });

  it('only work during a round', () => {
    const h = new EngineHarness();
    expect(h.engine.useItem('A', { item: 'star2x' }, h.now)).toMatchObject({ error: 'BAD_PHASE' });
  });

  it('eliminated players can still throw hourglass/lock, but not shield themselves', () => {
    const h = new EngineHarness(['A', 'B', 'C']).startGame({
      stages: [{ mode: 'precise', config: { roundMs: 60_000, maxErrors: 1 } }],
      modifiers: { itemsEnabled: true },
    });
    h.submit('A', 'zzzzqx');
    expect(h.engine.playerStatus('A').eliminated).toBe(true);
    expect(h.engine.useItem('A', { item: 'shield' }, h.now)).toMatchObject({ error: 'ITEM_UNAVAILABLE' });
    expect(h.engine.useItem('A', { item: 'hourglass', targetId: 'B' }, h.now)).toMatchObject({ ok: true });
    expect(h.engine.privateParts('B').personalDeadline).not.toBeNull();
    // Living players cannot target an eliminated one.
    expect(h.engine.useItem('B', { item: 'lock', targetId: 'A', letter: 'e' }, h.now)).toMatchObject({ error: 'INVALID_TARGET' });
  });
});
