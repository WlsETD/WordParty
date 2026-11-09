import { NICKNAME_MAX, NICKNAME_MIN } from '@wordparty/shared';

/** Letters (any script), digits, underscore and single spaces between them. */
const NICKNAME_RE = /^[\p{L}\p{N}_]+( [\p{L}\p{N}_]+)*$/u;

/** Returns the cleaned nickname, or null if it is not allowed. */
export function sanitizeNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  const length = [...name].length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) return null;
  if (!NICKNAME_RE.test(name)) return null;
  return name;
}
