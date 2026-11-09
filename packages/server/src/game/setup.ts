import {
  DEFAULT_MODIFIERS,
  MODE_DEFAULTS,
  MODE_IDS,
  MODE_LIMITS,
  type GameSetup,
  type ModeConfigMap,
  type ModeId,
  type Modifiers,
  type StageConfig,
} from '@wordparty/shared';

export const MAX_STAGES = 10;
export const MAX_ROUNDS_PER_STAGE = 5;

export const DEFAULT_SETUP: GameSetup = {
  stages: [{ mode: 'flash', rounds: 1, config: { ...MODE_DEFAULTS.flash } }],
  modifiers: { ...DEFAULT_MODIFIERS },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n));

/**
 * Fills in defaults and clamps numbers into MODE_LIMITS.
 * `unsafe` skips clamping (tests use tiny timings).
 */
export function sanitizeModeConfig<K extends ModeId>(mode: K, input: unknown, unsafe = false): ModeConfigMap[K] {
  const defaults = MODE_DEFAULTS[mode] as unknown as Record<string, number>;
  const limits = MODE_LIMITS[mode] as unknown as Record<string, readonly [number, number]>;
  const out: Record<string, number> = { ...defaults };
  if (isObj(input)) {
    for (const key of Object.keys(defaults)) {
      const v = input[key];
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = unsafe ? Math.round(v) : clamp(Math.round(v), limits[key]);
    }
  }
  if (mode === 'bomb' && out.fuseMaxMs < out.fuseMinMs) out.fuseMaxMs = out.fuseMinMs;
  return out as unknown as ModeConfigMap[K];
}

export function sanitizeModifiers(input: unknown, base: Modifiers = DEFAULT_MODIFIERS): Modifiers {
  const out: Modifiers = { ...base, bannedLetters: [...base.bannedLetters] };
  if (!isObj(input)) return out;
  if (Array.isArray(input.bannedLetters)) {
    const letters = new Set<string>();
    for (const l of input.bannedLetters) if (typeof l === 'string' && /^[a-zA-Z]$/.test(l)) letters.add(l.toLowerCase());
    // At most 5 banned letters so the game stays playable.
    out.bannedLetters = [...letters].slice(0, 5);
  }
  if (typeof input.minLength === 'number' && Number.isFinite(input.minLength)) out.minLength = clamp(Math.round(input.minLength), [2, 10]);
  if (typeof input.itemsEnabled === 'boolean') out.itemsEnabled = input.itemsEnabled;
  return out;
}

/** Validates a host's `host:setup` payload. Returns null if it is malformed. */
export function normalizeSetup(input: unknown, unsafe = false): GameSetup | null {
  if (!isObj(input) || !Array.isArray(input.stages)) return null;
  if (input.stages.length < 1 || input.stages.length > MAX_STAGES) return null;
  const stages: StageConfig[] = [];
  for (const s of input.stages) {
    if (!isObj(s) || typeof s.mode !== 'string' || !MODE_IDS.includes(s.mode as ModeId)) return null;
    const mode = s.mode as ModeId;
    const rounds = typeof s.rounds === 'number' && Number.isFinite(s.rounds) ? clamp(Math.round(s.rounds), [1, MAX_ROUNDS_PER_STAGE]) : 1;
    stages.push({ mode, rounds, config: sanitizeModeConfig(mode, s.config, unsafe) } as StageConfig);
  }
  return { stages, modifiers: sanitizeModifiers(input.modifiers) };
}
