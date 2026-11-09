import type { PlayerId, WordEntry } from '@wordparty/shared';
import type { ModeRoundScore } from './GameMode.js';

/** Keeps per-player points, word counts and longest words for a round. */
export class ScoreBook {
  private readonly rows = new Map<PlayerId, ModeRoundScore>();

  constructor(players: readonly PlayerId[]) {
    for (const p of players) this.rows.set(p, { points: 0, words: 0, longestWord: null });
  }

  row(p: PlayerId): ModeRoundScore {
    let r = this.rows.get(p);
    if (!r) this.rows.set(p, (r = { points: 0, words: 0, longestWord: null }));
    return r;
  }

  word(p: PlayerId, word: string, points: number): void {
    const r = this.row(p);
    r.points += points;
    r.words++;
    if (!r.longestWord || word.length > r.longestWord.length) r.longestWord = word;
  }

  add(p: PlayerId, points: number): void {
    this.row(p).points += points;
  }

  points(p: PlayerId): number {
    return this.row(p).points;
  }

  pointsMap(): Record<PlayerId, number> {
    const out: Record<PlayerId, number> = {};
    for (const [p, r] of this.rows) out[p] = r.points;
    return out;
  }

  toRecord(): Record<PlayerId, ModeRoundScore> {
    const out: Record<PlayerId, ModeRoundScore> = {};
    for (const [p, r] of this.rows) out[p] = { ...r };
    return out;
  }
}

/** Points for outlasting other players: `perPlayer` for each player eliminated before you. */
export const SURVIVAL_BONUS = 10;

export function addSurvivalBonus(
  book: ScoreBook,
  players: readonly PlayerId[],
  eliminatedOrder: readonly PlayerId[],
  perPlayer = SURVIVAL_BONUS,
): void {
  const n = players.length;
  eliminatedOrder.forEach((p, i) => book.add(p, i * perPlayer));
  for (const p of players) if (!eliminatedOrder.includes(p)) book.add(p, (n - 1) * perPlayer);
}

export function lastLetter(word: string): string {
  return word[word.length - 1];
}

/** Keeps only the newest `max` entries for the public state. */
export function tail<T>(list: readonly T[], max = 40): T[] {
  return list.length > max ? list.slice(list.length - max) : list.slice();
}

export function entry(word: string, playerId: PlayerId, points: number, at: number): WordEntry {
  return { word, playerId, points, at };
}

/** Rotates through living players in seat order. */
export function nextInOrder(order: readonly PlayerId[], current: PlayerId | null, isAlive: (p: PlayerId) => boolean): PlayerId | null {
  if (order.length === 0) return null;
  const start = current ? order.indexOf(current) : -1;
  for (let i = 1; i <= order.length; i++) {
    const p = order[(start + i + order.length) % order.length];
    if (isAlive(p)) return p;
  }
  return null;
}
