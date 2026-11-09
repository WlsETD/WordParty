import { describe, expect, it } from 'vitest';
import type { TrapRule } from '@wordparty/shared';
import { seededRng } from '../../../src/core/rng.js';
import { trapBroken } from '../../../src/dictionary/validator.js';
import { generateTraps } from '../../../src/modes/trapChain.js';
import { EngineHarness, findWord } from '../../helpers.js';

const setup = (over: Record<string, number> = {}) => ({
  stages: [{ mode: 'trapChain' as const, config: { turnMs: 5000, lives: 2, trapCount: 2, roundMs: 120_000, ...over } }],
});

function safeWord(h: EngineHarness) {
  const st = h.state('trapChain');
  return findWord(h.dict, st.requiredLetter, { used: [st.currentWord, ...st.history.map((x) => x.word)], traps: st.traps, minLength: 3, maxLength: 5 });
}

function trapWord(h: EngineHarness) {
  const st = h.state('trapChain');
  const used = new Set([st.currentWord, ...st.history.map((x) => x.word)]);
  return h.dict.wordsStartingWith(st.requiredLetter).find((w) => !used.has(w) && w.length >= 3 && st.traps.some((t) => trapBroken(w, t)))!;
}

describe('Trap Chain 陷阱接龍', () => {
  it('generates distinct, playable trap rules', () => {
    for (let seed = 0; seed < 200; seed++) {
      const rules = generateTraps(seededRng(seed), 3, ['e'], 3);
      expect(rules).toHaveLength(3);
      expect(rules[0].kind).toBe('NO_LETTER');
      const letters = rules.filter((r): r is Extract<TrapRule, { kind: 'NO_LETTER' }> => r.kind === 'NO_LETTER').map((r) => r.letter);
      expect(letters).not.toContain('e');
      expect(new Set(letters).size).toBe(letters.length);
      const end = rules.find((r) => r.kind === 'NO_END_LETTER') as { letter: string } | undefined;
      if (end) expect(letters).not.toContain(end.letter);
    }
  });

  it('the seed word avoids the traps; turns rotate after a valid word', () => {
    const h = new EngineHarness(['A', 'B', 'C']).startGame(setup());
    const st = h.state('trapChain');
    expect(st.traps).toHaveLength(2);
    expect(st.traps.some((t) => trapBroken(st.currentWord, t))).toBe(false);
    const first = st.activePlayerId!;
    const other = ['A', 'B', 'C'].find((p) => p !== first)!;
    expect(h.submit(other, safeWord(h))).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
    const w = safeWord(h);
    expect(h.submit(first, w)).toMatchObject({ ok: true, points: w.length });
    expect(h.state('trapChain').activePlayerId).not.toBe(first);
  });

  it('a non-trap error can be retried without losing a life', () => {
    const h = new EngineHarness(['A', 'B']).startGame(setup());
    const { activePlayerId: p, requiredLetter } = h.state('trapChain');
    expect(h.submit(p!, `${requiredLetter}zzqx`)).toEqual({ ok: false, reason: 'NOT_IN_DICT' });
    expect(h.state('trapChain')).toMatchObject({ activePlayerId: p, lives: { [p!]: 2 } });
  });

  it('stepping on a trap costs a life and 3 points and passes the turn', () => {
    const h = new EngineHarness(['A', 'B']).startGame(setup());
    const p = h.state('trapChain').activePlayerId!;
    const before = h.state('trapChain').requiredLetter;
    expect(h.submit(p, trapWord(h))).toEqual({ ok: false, reason: 'TRAP_HIT', penalty: 3 });
    const st = h.state('trapChain');
    expect(st.lives[p]).toBe(1);
    expect(st.activePlayerId).not.toBe(p);
    expect(st.requiredLetter).toBe(before);
    expect(h.eventsOf('TRAP_HIT')).toEqual([expect.objectContaining({ playerId: p, livesLeft: 1 })]);
  });

  it('timeouts cost lives; last player standing wins with survival bonus', () => {
    const h = new EngineHarness(['A', 'B']).startGame(setup({ lives: 1 }));
    const p = h.state('trapChain').activePlayerId!;
    const other = p === 'A' ? 'B' : 'A';
    h.advance(5000);
    expect(h.eventsOf('TURN_TIMEOUT')).toEqual([expect.objectContaining({ playerId: p, livesLeft: 0 })]);
    h.advance(100);
    expect(h.engine.phase).toBe('ROUND_END');
    const pts = Object.fromEntries(h.engine.lastRound!.scores.map((s) => [s.playerId, s.points]));
    expect(pts).toEqual({ [other]: 10, [p]: 0 });
  });

  it('a shield absorbs a trap hit', () => {
    const h = new EngineHarness(['A', 'B']).startGame({ ...setup(), modifiers: { itemsEnabled: true } });
    const p = h.state('trapChain').activePlayerId!;
    h.engine.useItem(p, { item: 'shield' }, h.now);
    h.submit(p, trapWord(h));
    expect(h.state('trapChain').lives[p]).toBe(2);
    expect(h.eventsOf('SHIELD_BLOCKED')).toHaveLength(1);
  });
});
