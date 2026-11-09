import { useEffect, useState } from 'react';
import {
  type ErrorCode,
  type GameEvent,
  type ItemType,
  type ModeId,
  type PlayerPublic,
  type StageConfig,
  type SubmitFailReason,
  type TrapRule,
} from '@wordparty/shared';

export const MODE_LABEL: Record<ModeId, { name: string; en: string }> = {
  flash: { name: '閃電搶答', en: 'FLASH' },
  precise: { name: '精準接龍', en: 'PRECISE' },
  bomb: { name: '炸彈傳遞', en: 'BOMB PASS' },
  lastStand: { name: '末位淘汰', en: 'LAST PLACE' },
  teamRelay: { name: '組隊接力', en: 'TEAM RELAY' },
  coopChain: { name: '合作長龍', en: 'CO-OP CHAIN' },
  trapChain: { name: '陷阱接龍', en: 'TRAP CHAIN' },
};

export const ITEM_LABEL: Record<ItemType, { icon: string; name: string; desc: string }> = {
  hourglass: { icon: '⏳', name: '縮時沙漏', desc: '對手少 3 秒' },
  lock: { icon: '🔒', name: '封鎖鎖頭', desc: '封住一個字母' },
  shield: { icon: '🛡️', name: '護盾', desc: '擋一次損失' },
  star2x: { icon: '⭐', name: '雙倍星星', desc: '下一字分數 ×2' },
};

/** Avatar index 0–11, matches `avatar` in the protocol. Emoji stand in until the design's SVG art is ported. */
export const AVATARS = ['🐶', '🐱', '🐼', '🦊', '🐸', '🐵', '🦁', '🐯', '🐨', '🐷', '🐮', '🐰'];

export const REASON_TEXT: Record<SubmitFailReason | 'OFFLINE', string> = {
  INVALID_CHARS: '只能輸入 a–z 字母',
  TOO_SHORT: '字太短了',
  WRONG_START: '開頭字母不對',
  NOT_IN_DICT: '字典裡沒有這個字',
  ALREADY_USED: '這個字已經用過了',
  BANNED_LETTER: '含有禁用字母',
  BLOCKED_LETTER: '含有被封鎖的字母',
  TRAP_HIT: '踩到陷阱！',
  NOT_YOUR_TURN: '還沒輪到你',
  ROUND_NOT_ACTIVE: '這回合已經結束',
  ELIMINATED: '你已出局',
  INVALID_TARGET: '不能傳給這位玩家',
  RATE_LIMITED: '送太快了，慢一點',
  OFFLINE: '連線中斷，重新連線後再試',
};

const ERROR_TEXT: Partial<Record<ErrorCode, string>> = {
  ROOM_NOT_FOUND: '找不到這個房間',
  ROOM_FULL: '房間已滿（10 人）',
  GAME_IN_PROGRESS: '遊戲進行中，等結束後再加入',
  NICKNAME_INVALID: '暱稱不合規定（1–8 字，可用中英數與底線）',
  NICKNAME_TAKEN: '這個暱稱已被使用',
  AVATAR_INVALID: '角色無效',
  NOT_HOST: '只有房主可以這樣做',
  NOT_ENOUGH_PLAYERS: '至少需要 2 位玩家',
  BAD_PHASE: '現在不能這樣做',
  ITEM_UNAVAILABLE: '沒有可用的道具',
  ITEM_COOLDOWN: '道具冷卻中',
  INVALID_TARGET: '目標不正確',
  PLAYER_NOT_FOUND: '找不到這位玩家',
  INVALID_PAYLOAD: '送出的內容有誤',
  RATE_LIMITED: '操作太頻繁，稍等一下',
};

/** Human-readable text for a failed request ack. */
export function errorText(res: { error: ErrorCode; message?: string }): string {
  if (res.message === 'offline') return '連線中，請稍後再試';
  if (res.message === 'timeout') return '伺服器沒有回應，請再試一次';
  return ERROR_TEXT[res.error] ?? '發生錯誤，請再試一次';
}

export function nameOf(players: readonly PlayerPublic[], id: string | null | undefined): string {
  if (!id) return '—';
  return players.find((p) => p.id === id)?.name ?? '（已離開）';
}

export function avatarOf(players: readonly PlayerPublic[], id: string | null | undefined): string {
  return AVATARS[players.find((p) => p.id === id)?.avatar ?? 0];
}

export function ruleText(r: TrapRule): string {
  switch (r.kind) {
    case 'NO_LETTER':
      return `不可含 ${r.letter.toUpperCase()}`;
    case 'NO_END_LETTER':
      return `不可以 ${r.letter.toUpperCase()} 結尾`;
    case 'MAX_LENGTH':
      return `最多 ${r.length} 個字母`;
  }
}

export function seconds(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}

/** Total length of a stage's main timer, used to scale the progress bar. */
export function totalOf(stage: StageConfig): number {
  const c = stage.config as unknown as Record<string, number | undefined>;
  return c.roundMs ?? c.turnMs ?? c.heatMs ?? 1;
}

/** Re-renders every `ms` with the synced server time. */
export function useNow(now: () => number, ms = 100): number {
  const [t, setT] = useState(() => now());
  useEffect(() => {
    const id = setInterval(() => setT(now()), ms);
    return () => clearInterval(id);
  }, [now, ms]);
  return t;
}

/** One-line description of a game event for the TV ticker. Null for events not worth showing. */
export function eventText(e: GameEvent, players: readonly PlayerPublic[]): string | null {
  const n = (id: string) => nameOf(players, id);
  switch (e.type) {
    case 'WORD_ACCEPTED':
      return `${n(e.playerId)} 接 ${e.word.toUpperCase()}  +${e.points}${e.combo && e.combo >= 3 ? `  連擊 ×${e.combo}` : ''}`;
    case 'WORD_REJECTED':
      return null;
    case 'BOMB_PASSED':
      return `💣 ${n(e.from)} 傳給 ${n(e.to)}`;
    case 'BOMB_EXPLODED':
      return `💥 ${n(e.playerId)} 爆炸！${e.shielded ? '護盾擋下了' : `剩 ${e.livesLeft} 命`}`;
    case 'PLAYER_ELIMINATED':
      return `❌ ${n(e.playerId)} 出局`;
    case 'TURN_TIMEOUT':
      return `⏰ ${n(e.playerId)} 逾時`;
    case 'TRAP_HIT':
      return `⚠️ ${n(e.playerId)} 踩到陷阱（${e.word.toUpperCase()}）`;
    case 'SHIELD_BLOCKED':
      return `🛡️ ${n(e.playerId)} 的護盾擋下了`;
    case 'ITEM_USED':
      return `${ITEM_LABEL[e.item].icon} ${n(e.by)} 使用${ITEM_LABEL[e.item].name}`;
    case 'MILESTONE':
      return `★ 里程碑！已接 ${e.count} 字`;
    case 'HEAT_END':
      return e.eliminatedId ? `第 ${e.heat} 回合結束 · ${n(e.eliminatedId)} 淘汰` : `第 ${e.heat} 回合結束`;
    case 'TEAM_WIN':
      return `🏁 ${e.team} 隊獲勝`;
    case 'CHAIN_COMPLETE':
      return '🏆 長龍完成！';
  }
}
