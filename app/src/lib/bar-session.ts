// bar-session.ts — what the bar looked like when the visitor left the page.
// Created 2026-09-27 (V12, "continue" across navigation).
//
// Per TAB, in sessionStorage: whether the bar was pinned open, full screen,
// the unsent draft and the thread's scroll position. The thread itself is the
// chat store's job (localStorage + the server); this is only the bar's own
// state, so a visitor who clicks a link mid-conversation lands on the next
// page with the bar offering to carry on, their half-typed question intact.
//
// Every access is wrapped: storage can be blocked (sandbox, privacy mode), and
// then the bar simply forgets between pages. A snapshot older than
// SESSION_TTL_MS is ignored, so a tab left overnight does not greet the
// visitor with yesterday's "continue".

export const SESSION_KEY_PREFIX = '__pawbar_session_v1:';
export const SESSION_TTL_MS = 30 * 60 * 1000;
const DRAFT_MAX = 4000;

export interface BarSession {
  /** The bar was pinned open (or full screen) when the page went away. */
  open: boolean;
  full: boolean;
  draft: string;
  /** Thread scrollTop, or null when the reader was at the bottom. */
  scroll: number | null;
  at: number;
}

export function readBarSession(key: string, now = Date.now()): BarSession | null {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY_PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<BarSession>;
    if (typeof v !== 'object' || !v || typeof v.at !== 'number' || now - v.at > SESSION_TTL_MS) return null;
    return {
      open: v.open === true,
      full: v.full === true,
      draft: typeof v.draft === 'string' ? v.draft.slice(0, DRAFT_MAX) : '',
      scroll: typeof v.scroll === 'number' && Number.isFinite(v.scroll) && v.scroll >= 0 ? v.scroll : null,
      at: v.at,
    };
  } catch {
    return null; // blocked or malformed: nothing to carry over
  }
}

export function writeBarSession(key: string, s: BarSession): void {
  if (!key) return;
  try {
    sessionStorage.setItem(SESSION_KEY_PREFIX + key, JSON.stringify({ ...s, draft: s.draft.slice(0, DRAFT_MAX) }));
  } catch {
    /* storage blocked: the bar forgets between pages */
  }
}

export function clearBarSession(key: string): void {
  if (!key) return;
  try {
    sessionStorage.removeItem(SESSION_KEY_PREFIX + key);
  } catch {
    /* nothing to clear */
  }
}
