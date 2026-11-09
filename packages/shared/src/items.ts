/**
 * Items (enabled with the `itemsEnabled` modifier).
 *
 * | Item | Target | Effect |
 * |---|---|---|
 * | `hourglass` 縮時沙漏 | another player | Removes 3 s from the target's current (or next) time limit |
 * | `lock` 封鎖鎖頭 | another player + a letter | The target's next word may not contain that letter (except as its first letter) |
 * | `shield` 護盾 | self | Blocks one explosion, one error, one trap, one timeout or one elimination |
 * | `star2x` 雙倍星星 | self | Your next accepted word scores double |
 *
 * Each player receives one of every item the current mode supports at the start of each round.
 * Eliminated players may still throw `hourglass` and `lock` at living players.
 */
export type ItemType = 'hourglass' | 'lock' | 'shield' | 'star2x';

export const ITEM_TYPES: readonly ItemType[] = ['hourglass', 'lock', 'shield', 'star2x'];

/** Items that need a `targetId`. */
export const TARGETED_ITEMS: readonly ItemType[] = ['hourglass', 'lock'];

export interface ItemState {
  type: ItemType;
  count: number;
  /** Server timestamp (ms) until which this player cannot use any item; 0 when ready. */
  cooldownUntil: number;
}
