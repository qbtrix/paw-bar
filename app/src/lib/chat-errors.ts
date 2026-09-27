// chat-errors.ts — What went wrong with a send, in the visitor's words.
// Created 2026-09-27 (paw-bar states, section D + C7; spec
// docs/design/drafts/2026-09-27-paw-bar-states-ux-failures.md §2–3, §10).
//
// The live bug this exists for: chat-client handed the store raw strings
// ("paw-bar chat failed (429)", the browser's "Failed to fetch", the verbatim
// message of an SSE error frame relayed from the executor) and the old shell
// printed them to visitors. Now chat-client reports a structured RawFailure,
// classifyError turns it into one of eight kinds, and the only text a visitor
// ever sees comes from FAILURE_COPY. The real reason goes to the owner through
// console.warn (reportFailure), once per kind per page view.
//
// classifyError is PURE (no DOM, no clock, no console) so it tests like
// dispatchFrame. Two rules are load-bearing:
//   * key on `detail`, not status — one 403 means five different things;
//   * the quota never-strand rule — concierge_quota_exceeded is bar-level
//     `unavailable` ONLY for the first user turn of a thread. The server
//     refuses quota only when no conversation row exists, so anywhere else it
//     is treated as a per-turn `unreachable` with Retry: locking a visitor out
//     of a conversation they are already in is the worse error.
// Deviation from §10, on purpose: the frame variant carries an optional
// `message` (the SSE error text) so ownerReason can log it. It is never shown.

export type FailureKind =
  | 'offline'
  | 'unreachable'
  | 'rate_limited'
  | 'rejected'
  | 'unavailable'
  | 'interrupted'
  | 'server'
  | 'empty';

export type RawFailure =
  | { source: 'network'; online: boolean; afterResponse: boolean }
  | { source: 'http'; status: number; detail: string | null; retryAfter: string | null }
  | { source: 'frame'; event: 'error' | 'interrupted'; message?: string }
  | { source: 'empty' };

export interface ChatFailure {
  kind: FailureKind;
  scope: 'turn' | 'bar';
  on: 'user' | 'assistant' | 'none';
  /** Can "Talk to a person" (POST /paw-bar/request-human) still succeed? */
  contactable: boolean;
  /** rate_limited only: how long Send stays blocked. */
  retryAfterMs?: number;
  /** Console only, never rendered. */
  ownerReason: string;
}

/** Cooldown when the server gives no readable Retry-After (the chat 429 sends
 *  none today, and the iframe could not read it without an expose header). */
export const DEFAULT_COOLDOWN_MS = 30_000;
const MIN_COOLDOWN_MS = 5_000;
export const MAX_COOLDOWN_MS = 60_000;

/** `unavailable` details where request-human still gets through: its front gate
 *  checks key/origin/binding/entitlement, not the agent, connectors or quota. */
const CONTACTABLE = new Set([
  'concierge_quota_exceeded',
  'widget has no concierge agent',
  'concierge_pocket_has_connectors',
  'concierge_connector_check_failed',
]);
const NOT_CONTACTABLE = new Set([
  'Widget not found',
  'invalid_site_key',
  'concierge_disabled',
  'concierge_not_entitled',
  'origin_not_allowed',
  'widget_workspace_mismatch',
  'widget_pocket_mismatch',
]);

function turn(kind: FailureKind, on: ChatFailure['on'], ownerReason: string): ChatFailure {
  return { kind, scope: 'turn', on, contactable: true, ownerReason };
}

/** Retry-After as delta-seconds, clamped 5–60s; anything else → 30s. */
export function cooldownMs(retryAfter: string | null): number {
  const secs = retryAfter !== null && /^\s*\d+\s*$/.test(retryAfter) ? Number(retryAfter) : NaN;
  if (!Number.isFinite(secs)) return DEFAULT_COOLDOWN_MS;
  return Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, secs * 1000));
}

export function classifyError(raw: RawFailure, ctx: { firstUserTurn: boolean }): ChatFailure {
  switch (raw.source) {
    case 'network':
      // A read that died after the response started is a cut-off reply: it may
      // have reached the model, so it is never queued for an automatic resend.
      if (raw.afterResponse) return turn('interrupted', 'assistant', 'stream read failed mid-reply');
      // Only onLine === false proves offline; a TypeError while "online" is also
      // a 5xx that lost its CORS headers, so it is unreachable, not queued.
      return raw.online
        ? turn('unreachable', 'user', 'fetch rejected while online (network, DNS, or a response without CORS headers)')
        : turn('offline', 'user', 'browser offline');
    case 'frame':
      return raw.event === 'interrupted'
        ? turn('interrupted', 'assistant', 'server interrupted the reply')
        : turn('server', 'assistant', `server error frame: ${raw.message ?? '(no message)'}`);
    case 'empty':
      return turn('empty', 'assistant', 'stream ended cleanly with no text');
    case 'http': {
      const { status, detail } = raw;
      const reason = `HTTP ${status} ${detail ?? '(no detail)'}`;
      if (status === 429) {
        return { ...turn('rate_limited', 'user', reason), retryAfterMs: cooldownMs(raw.retryAfter) };
      }
      if (status === 400 && detail === 'message_rejected') {
        return { kind: 'rejected', scope: 'turn', on: 'none', contactable: true, ownerReason: reason };
      }
      if (detail === 'concierge_quota_exceeded' && !ctx.firstUserTurn) {
        // Never strand a thread: the server should not have refused this turn.
        return turn('unreachable', 'user', `${reason} (mid-thread, kept per-turn)`);
      }
      if (detail !== null && (CONTACTABLE.has(detail) || NOT_CONTACTABLE.has(detail))) {
        return { kind: 'unavailable', scope: 'bar', on: 'user', contactable: CONTACTABLE.has(detail), ownerReason: reason };
      }
      // Any 5xx, and any 4xx this table doesn't know.
      return turn('unreachable', 'user', reason);
    }
  }
}

/** Visitor-facing copy per kind. `{s}` in rate_limited is the seconds left;
 *  fill it with formatCopy. Nothing else a visitor reads comes from a failure. */
export const FAILURE_COPY: Record<FailureKind, { turn?: string; line?: string; sr: string }> = {
  offline: {
    turn: 'Waiting for connection',
    line: "You're offline. We'll send this when you're back.",
    sr: "You're offline. We'll send this when you're back.",
  },
  unreachable: { turn: 'Not sent', sr: "Your message wasn't sent." },
  rate_limited: {
    turn: 'Not sent',
    line: "You're sending messages quickly. You can send again in {s}s.",
    sr: "You're sending messages quickly. You can send again in about {s} seconds.",
  },
  rejected: {
    line: "That message couldn't be sent. Try rewording it.",
    sr: "That message couldn't be sent. Try rewording it.",
  },
  unavailable: {
    turn: 'Not sent',
    line: "Chat isn't available right now.",
    sr: "Chat isn't available right now.",
  },
  interrupted: { turn: 'The reply was cut off', sr: 'The reply was cut off.' },
  server: { turn: 'Something went wrong', sr: 'Something went wrong.' },
  empty: { turn: 'No answer came back', sr: 'No answer came back.' },
};

/** Appended to the `unavailable` line when a person can still be reached. */
export const CONTACT_OFFER = 'Leave your email and the team will get back to you.';
/** The near-input line once the offline queue is full (sixth send). */
export const OFFLINE_QUEUE_FULL = "You're offline. Messages will send when you're back.";

export function formatCopy(text: string, seconds: number): string {
  return text.replace('{s}', String(Math.max(0, Math.ceil(seconds))));
}

const reported = new Set<FailureKind>();

/** The owner's channel: console.warn once per kind per page view. Offline is
 *  the visitor's own network, not something the owner can fix, so it is not
 *  logged. `seen` is injectable for tests. */
export function reportFailure(failure: ChatFailure, seen: Set<FailureKind> = reported): void {
  if (failure.kind === 'offline' || seen.has(failure.kind)) return;
  seen.add(failure.kind);
  console.warn('[paw-bar] chat refused:', failure.ownerReason);
}
