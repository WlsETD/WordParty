import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Dictionary } from '../../src/dictionary/Dictionary.js';
import { validateWord } from '../../src/dictionary/validator.js';
import { seededRng } from '../../src/core/rng.js';
import { sanitizeNickname } from '../../src/core/nickname.js';
import { RateLimiter } from '../../src/core/rateLimiter.js';
import { ManualClock } from '../../src/core/clock.js';

const ENABLE_PATH = fileURLToPath(new URL('../../data/enable1.txt', import.meta.url));

describe('Dictionary (ENABLE)', () => {
  const dict = Dictionary.fromFile(ENABLE_PATH);

  it('loads the full ENABLE list', () => {
    expect(dict.size).toBeGreaterThan(170_000);
    expect(dict.has('rabbit')).toBe(true);
    expect(dict.has('zzzzq')).toBe(false);
  });

  it('picks seed words and start letters', () => {
    const rng = seededRng(1);
    const seed = dict.randomSeedWord(rng, (w) => !w.includes('e'));
    expect(seed).not.toContain('e');
    expect(dict.has(seed)).toBe(true);
    expect(dict.randomStartLetter(rng, ['a'])).not.toBe('a');
  });
});

describe('validateWord', () => {
  const dict = new Dictionary(['apple', 'ant', 'eagle', 'egg', 'tiger', 'set', 'star']);
  const base = { requiredStart: 'a', minLength: 3, used: new Set<string>() };

  it('accepts a valid word and normalizes case/space', () => {
    expect(validateWord(dict, '  APPLE ', base)).toEqual({ ok: true, word: 'apple' });
  });

  it.each([
    ['app1e', 'INVALID_CHARS'],
    ['', 'INVALID_CHARS'],
    ['äpple', 'INVALID_CHARS'],
    ['an', 'TOO_SHORT'],
    ['eagle', 'WRONG_START'],
    ['abcde', 'NOT_IN_DICT'],
  ])('%s → %s', (word, reason) => {
    expect(validateWord(dict, word, base)).toMatchObject({ ok: false, reason });
  });

  it('rejects non-strings', () => {
    expect(validateWord(dict, 42, base)).toMatchObject({ ok: false, reason: 'INVALID_CHARS' });
  });

  it('rejects used words', () => {
    expect(validateWord(dict, 'apple', { ...base, used: new Set(['apple']) })).toMatchObject({ reason: 'ALREADY_USED' });
  });

  it('enforces min length from modifiers', () => {
    expect(validateWord(dict, 'ant', { ...base, minLength: 4 })).toMatchObject({ reason: 'TOO_SHORT' });
  });

  it('banned letters apply anywhere; lock letters skip the first letter', () => {
    expect(validateWord(dict, 'apple', { ...base, bannedLetters: ['a'] })).toMatchObject({ reason: 'BANNED_LETTER' });
    expect(validateWord(dict, 'apple', { ...base, blockedLetters: ['a'] })).toEqual({ ok: true, word: 'apple' });
    expect(validateWord(dict, 'apple', { ...base, blockedLetters: ['p'] })).toMatchObject({ reason: 'BLOCKED_LETTER' });
  });

  it('checks trap rules last', () => {
    const traps = [{ kind: 'NO_LETTER', letter: 'e' }] as const;
    expect(validateWord(dict, 'apple', { ...base, traps })).toMatchObject({ reason: 'TRAP_HIT', trap: traps[0] });
    expect(validateWord(dict, 'ant', { ...base, traps })).toEqual({ ok: true, word: 'ant' });
    // A non-word never counts as a trap.
    expect(validateWord(dict, 'aeeee', { ...base, traps })).toMatchObject({ reason: 'NOT_IN_DICT' });
    expect(validateWord(dict, 'set', { ...base, requiredStart: 's', traps: [{ kind: 'NO_END_LETTER', letter: 't' }] })).toMatchObject({ reason: 'TRAP_HIT' });
    expect(validateWord(dict, 'tiger', { ...base, requiredStart: 't', traps: [{ kind: 'MAX_LENGTH', length: 4 }] })).toMatchObject({ reason: 'TRAP_HIT' });
  });

  it('accepts any start when requiredStart is null', () => {
    expect(validateWord(dict, 'tiger', { ...base, requiredStart: null })).toEqual({ ok: true, word: 'tiger' });
  });
});

describe('sanitizeNickname', () => {
  it.each([
    ['Kiki', 'Kiki'],
    ['  大雄  ', '大雄'],
    ['a  b', 'a b'],
    ['八個字的名字真長', '八個字的名字真長'],
  ])('accepts %j', (raw, expected) => expect(sanitizeNickname(raw)).toBe(expected));

  it.each(['', '   ', '九個字的名字太長了啦', '<script>', 'a/b', 'hi!', 123, null])('rejects %j', (raw) => {
    expect(sanitizeNickname(raw)).toBeNull();
  });
});

describe('RateLimiter', () => {
  it('allows a burst, then refills over time', () => {
    const clock = new ManualClock();
    const rl = new RateLimiter(clock, 10, 5);
    for (let i = 0; i < 5; i++) expect(rl.take()).toBe(true);
    expect(rl.take()).toBe(false);
    expect(rl.strikes).toBe(1);
    clock.advance(100);
    expect(rl.take()).toBe(true);
    expect(rl.take()).toBe(false);
  });
});
