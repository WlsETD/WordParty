import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@wordparty/shared';
import type { Clock } from '../core/clock.js';
import type { Rng } from '../core/rng.js';
import type { Dictionary } from '../dictionary/Dictionary.js';
import { Room, type RoomOptions, type RoomOutput } from './Room.js';

export interface RoomManagerOptions extends RoomOptions {
  clock: Clock;
  rng: Rng;
  dict: Dictionary;
  countdownMs?: number;
  roundEndMs?: number;
  unsafeConfig?: boolean;
}

export interface ManagerOutput extends RoomOutput {
  closed(code: string, reason: 'IDLE' | 'EMPTY'): void;
}

export function generateRoomCode(rng: Rng): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[rng.int(0, ROOM_CODE_ALPHABET.length - 1)];
  return code;
}

export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const c of code) if (!ROOM_CODE_ALPHABET.includes(c)) return null;
  return code;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly opts: RoomManagerOptions,
    private readonly output: ManagerOutput,
  ) {}

  get size(): number {
    return this.rooms.size;
  }

  create(): Room {
    let code = generateRoomCode(this.opts.rng);
    // 32^4 ≈ 1M codes; collisions are rare, just retry.
    for (let i = 0; this.rooms.has(code); i++) {
      if (i > 10_000) throw new Error('no free room codes');
      code = generateRoomCode(this.opts.rng);
    }
    const room = new Room(code, this.opts, this.output, this.opts);
    this.rooms.set(code, room);
    return room;
  }

  get(raw: unknown): Room | undefined {
    const code = normalizeRoomCode(raw);
    return code ? this.rooms.get(code) : undefined;
  }

  /** Ticks every room and destroys idle or empty ones. */
  tick(now: number): void {
    for (const room of this.rooms.values()) {
      room.tick(now);
      if (room.isEmpty) this.destroy(room.code, 'EMPTY');
      else if (room.isIdle(now)) this.destroy(room.code, 'IDLE');
    }
  }

  destroy(code: string, reason: 'IDLE' | 'EMPTY'): void {
    if (!this.rooms.delete(code)) return;
    this.output.closed(code, reason);
  }
}
