import { MAX_WORD_LENGTH, type SubmitFailReason, type TrapRule } from '@wordparty/shared';
import type { Dictionary } from './Dictionary.js';

export interface ValidationRules {
  /** Letter the word must start with; null for any. */
  requiredStart: string | null;
  minLength: number;
  /** Words already used (lowercase). */
  used: ReadonlySet<string>;
  /** Letters banned by a modifier, anywhere in the word. */
  bannedLetters?: Iterable<string>;
  /** Letters blocked by a Lock item; ignored as the first letter. */
  blockedLetters?: Iterable<string>;
  /** Trap Chain rules. */
  traps?: readonly TrapRule[];
}

export type ValidationResult =
  | { ok: true; word: string }
  | { ok: false; reason: SubmitFailReason; word: string; trap?: TrapRule };

export function normalizeWord(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

export function trapBroken(word: string, rule: TrapRule): boolean {
  switch (rule.kind) {
    case 'NO_LETTER':
      return word.includes(rule.letter);
    case 'NO_END_LETTER':
      return word.endsWith(rule.letter);
    case 'MAX_LENGTH':
      return word.length > rule.length;
  }
}

/**
 * Checks a word. Order: INVALID_CHARS → TOO_SHORT → WRONG_START → NOT_IN_DICT → ALREADY_USED
 * → BANNED_LETTER → BLOCKED_LETTER → TRAP_HIT. Traps come last so a non-word never costs a life.
 */
export function validateWord(dict: Dictionary, raw: unknown, rules: ValidationRules): ValidationResult {
  const word = normalizeWord(raw);
  if (!word || word.length > MAX_WORD_LENGTH || !/^[a-z]+$/.test(word)) return { ok: false, reason: 'INVALID_CHARS', word };
  if (word.length < rules.minLength) return { ok: false, reason: 'TOO_SHORT', word };
  if (rules.requiredStart && word[0] !== rules.requiredStart) return { ok: false, reason: 'WRONG_START', word };
  if (!dict.has(word)) return { ok: false, reason: 'NOT_IN_DICT', word };
  if (rules.used.has(word)) return { ok: false, reason: 'ALREADY_USED', word };
  for (const l of rules.bannedLetters ?? []) if (word.includes(l)) return { ok: false, reason: 'BANNED_LETTER', word };
  for (const l of rules.blockedLetters ?? []) if (word.slice(1).includes(l)) return { ok: false, reason: 'BLOCKED_LETTER', word };
  for (const trap of rules.traps ?? []) if (trapBroken(word, trap)) return { ok: false, reason: 'TRAP_HIT', word, trap };
  return { ok: true, word };
}
