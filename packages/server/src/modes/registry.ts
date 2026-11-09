import type { ModeConfigMap, ModeId } from '@wordparty/shared';
import type { GameMode, ModeDefinition } from './GameMode.js';
import { bombMode } from './bomb.js';
import { coopChainMode } from './coopChain.js';
import { flashMode } from './flash.js';
import { lastStandMode } from './lastStand.js';
import { preciseMode } from './precise.js';
import { teamRelayMode } from './teamRelay.js';
import { trapChainMode } from './trapChain.js';

/**
 * All mode plug-ins. To add a mode: add its id, config and public state to `@wordparty/shared`,
 * implement `GameMode`, and register it here.
 */
export const MODE_REGISTRY: { [K in ModeId]: ModeDefinition<K> } = {
  flash: flashMode,
  precise: preciseMode,
  bomb: bombMode,
  lastStand: lastStandMode,
  teamRelay: teamRelayMode,
  coopChain: coopChainMode,
  trapChain: trapChainMode,
};

export function createMode<K extends ModeId>(id: K, config: ModeConfigMap[K]): GameMode<K> {
  const def = MODE_REGISTRY[id] as ModeDefinition<K>;
  return def.create(config);
}
