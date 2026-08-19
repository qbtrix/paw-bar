// operator-poll.ts — Visitor-side delivery channel for the HUMAN half of the
// conversation. Created 2026-07-30 (type-to-takeover, slice 2): the site owner
// can step into a live thread from their inbox, and when they do the bot mutes.
// This is the poll that brings their words back to the glass app. Sibling of
// decision-contact: one fetch, credentials omitted, CORS mode, no retry, and
// every failure degrades SILENTLY — a backend without this endpoint, a refusal,
// a network blip or a malformed body must leave the widget behaving EXACTLY as
// it did before this file existed. Contract (exact):
//   GET {endpoint}/paw-bar/messages/{widget_id}/{customer_ref}
//       ?signed_key=…&after=<iso8601|omitted>&conversation_id=<id|omitted>
//     → {messages: [{role:"owner"|"system", content, at}…], bot_paused: bool}
//   2026-08-19: `conversation_id` scopes the read to the thread on screen. A
//   visitor may hold several, and without it the backend answers for all of
//   them — so an owner's reply to one surfaces in another, and `bot_paused`
//   describes a thread the visitor isn't looking at. Omitting it keeps the old
//   whole-visitor behaviour, which is what a cached bundle will do.
//     refusals mirror the chat endpoint: 404 unknown widget · 429 · 401 bad
//     key · 403 origin.
// Same-origin GETs from our own frame carry no Origin header; the backend
// resolves that via Sec-Fetch-Site, so the fetch conventions stay identical to
// decision-contact's.
//
// Everything here is pure-ish and DOM-free so the validation tests headlessly
// (tests/operator.spec.ts). Defensive rules, in order:
//   * body must be an object with an ARRAY `messages` — anything else → null.
//   * per row: role in the allowlist, content + at non-empty strings. A row
//     failing any check is DROPPED; the good rows still land.
//   * content is trimmed and capped (OPERATOR_CONTENT_MAX) — the owner path is
//     server-authored but a compromised one must not be able to blow up the
//     visitor's localStorage row.
//   * the list is capped (OPERATOR_MESSAGES_CAP) per poll.
//   * bot_paused is honoured only as a real boolean; anything else reads false.
// The content itself NEVER becomes markup — MessageRow binds owner/system
// turns as text, unlike assistant turns which render sanitized markdown.

import type { ConciergeChatConfig } from './chat-client';

export const OPERATOR_MESSAGES_CAP = 50;
export const OPERATOR_CONTENT_MAX = 4000;

export type OperatorRole = 'owner' | 'system';

export interface OperatorMessage {
  role: OperatorRole;
  content: string;
  /** Server timestamp (ISO 8601) — the poll's high-water mark. */
  at: string;
}

export interface OperatorPoll {
  messages: OperatorMessage[];
  botPaused: boolean;
}

/** Deterministic id for an owner/system turn: same message → same id on every
 *  poll AND after a page reload (the transcript persists ids), so appending is
 *  idempotent even when a backend ignores `after` and replays the whole list. */
export function operatorMessageId(message: OperatorMessage): string {
  return `op-${message.role}-${message.at}-${fnv1a(message.content)}`;
}

/** The later of two ISO timestamps (either may be ''). Unparseable values lose,
 *  so a junk `at` can never poison the high-water mark into the far future. */
export function laterAt(a: string, b: string): string {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(tb)) return a;
  if (Number.isNaN(ta)) return b;
  return tb > ta ? b : a;
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function base(endpoint: string): string {
  return endpoint.replace(/\/$/, '');
}

/** One poll for owner/system turns newer than `after`. Any failure (HTTP
 *  refusal, network error, endpoint absent on an old backend, malformed body)
 *  → null, and the caller leaves the thread untouched. */
export async function fetchOperatorMessages(
  config: ConciergeChatConfig,
  after = '',
  signal?: AbortSignal,
  conversationId = '',
): Promise<OperatorPoll | null> {
  const q = new URLSearchParams({ signed_key: config.signedKey });
  if (after) q.set('after', after);
  // Which thread we are asking about (2026-08-19). Without it the backend
  // answers for the visitor's WHOLE history, so an owner's reply to a
  // conversation they finished last week appears inside the one they are typing
  // in now — and `bot_paused` describes a different thread than the one on
  // screen. Omitted when the visitor has no conversation yet (they have never
  // sent a turn), which is exactly when there is nothing to mis-deliver.
  if (conversationId) q.set('conversation_id', conversationId);
  const url =
    `${base(config.endpoint)}/paw-bar/messages/${encodeURIComponent(config.widgetId)}` +
    `/${encodeURIComponent(config.customerRef)}?${q.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', credentials: 'omit', mode: 'cors', cache: 'no-store', signal });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let data: { messages?: unknown; bot_paused?: unknown };
  try {
    data = (await res.json()) as { messages?: unknown; bot_paused?: unknown };
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) return null;

  const messages: OperatorMessage[] = [];
  for (const item of data.messages) {
    if (messages.length >= OPERATOR_MESSAGES_CAP) break;
    if (!item || typeof item !== 'object') continue;
    const row = item as { role?: unknown; content?: unknown; at?: unknown };
    if (row.role !== 'owner' && row.role !== 'system') continue;
    const content = typeof row.content === 'string' ? row.content.trim().slice(0, OPERATOR_CONTENT_MAX) : '';
    const at = typeof row.at === 'string' ? row.at.trim() : '';
    if (!content || !at) continue;
    messages.push({ role: row.role, content, at });
  }

  return { messages, botPaused: data.bot_paused === true };
}
