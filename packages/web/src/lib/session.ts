/** Remembers which room a screen belongs to, so a page reload or a dropped connection can rejoin. */
export type Role = 'tv' | 'phone';

export interface Session {
  code: string;
  token: string;
}

const key = (role: Role) => `wordparty.session.${role}`;

export function loadSession(role: Role): Session | null {
  try {
    const raw = localStorage.getItem(key(role));
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    return typeof s.code === 'string' && typeof s.token === 'string' ? { code: s.code, token: s.token } : null;
  } catch {
    return null;
  }
}

export function saveSession(role: Role, s: Session): void {
  try {
    localStorage.setItem(key(role), JSON.stringify(s));
  } catch {
    // Private mode or blocked storage: the game still works, it just cannot survive a reload.
  }
}

export function clearSession(role: Role): void {
  try {
    localStorage.removeItem(key(role));
  } catch {
    /* ignore */
  }
}
