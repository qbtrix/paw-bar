// conversations-client.ts — the visitor's own conversation list, and the call
// that starts a new one. Created 2026-08-19 (Messenger): the Messages tab needs
// a LIST, and until the backend gave conversations real identities there was
// nothing to list — a visitor had exactly one conversation per widget, forever.
//
// Sibling of articles-client and operator-poll, and it keeps their conventions
// exactly: one fetch, `credentials: 'omit'`, CORS mode, no retry, and every
// failure — refusal, network error, endpoint absent on an older backend,
// malformed body — degrades SILENTLY to a safe value. A public widget never
// shows an error wall over its own bookkeeping; the visitor came here to ask a
// question, and a Messages tab that can't load is a quiet empty state, not a
// stop sign.
//
// Contract:
//   GET  {endpoint}/paw-bar/conversations?w=&key=&customer_ref=
//        → {conversations: [{id, state, preview, last_message_at, active}…]}
//   POST {endpoint}/paw-bar/conversations {key, w, customer_ref}
//        → {id, state, preview, last_message_at, active}
//   Refusals mirror the chat endpoint: 404 unknown widget · 429 · 401 bad key ·
//   403 origin.
//
// Same-origin requests from our own frame carry no Origin header; the backend
// resolves that via Sec-Fetch-Site, so the fetch conventions stay identical to
// the siblings'.

import type { ConciergeChatConfig } from './chat-client';

/** Defensive bound on a list the widget renders. The server caps at 50; this is
 *  the client refusing to be talked into more by a malformed body. */
export const CONVERSATIONS_CAP = 50;
/** Previews are server-capped at 140; clip again rather than trust the wire. */
export const PREVIEW_MAX = 200;
/** Defensive bound on one thread's turns, mirroring CONVERSATIONS_CAP's reason:
 *  the server caps this too, and the client still refuses to be talked into more
 *  by a malformed body. */
export const MESSAGES_CAP = 200;

export interface VisitorConversation {
  id: string;
  state: string;
  preview: string;
  lastMessageAt: string;
  /** The conversation in progress — the one a turn lands on by default. */
  active: boolean;
}

type ConversationsConfig = Pick<ConciergeChatConfig, 'endpoint' | 'widgetId' | 'signedKey'>;

/** Coerce one wire row, or null if it cannot be trusted. */
function readRow(raw: unknown): VisitorConversation | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  if (!id) return null;
  const preview = typeof row.preview === 'string' ? row.preview.slice(0, PREVIEW_MAX) : '';
  return {
    id,
    state: typeof row.state === 'string' && row.state ? row.state : 'open',
    preview,
    lastMessageAt: typeof row.last_message_at === 'string' ? row.last_message_at : '',
    // Only a real boolean counts — anything else reads false, so a malformed
    // body can never mark two conversations active and confuse the composer
    // about which one it is writing into.
    active: row.active === true,
  };
}

/** This visitor's conversations, newest first. `[]` on any failure. */
export async function fetchConversations(
  config: ConversationsConfig,
  customerRef: string,
): Promise<VisitorConversation[]> {
  const url = new URL(`${config.endpoint}/paw-bar/conversations`);
  url.searchParams.set('w', config.widgetId);
  url.searchParams.set('key', config.signedKey);
  url.searchParams.set('customer_ref', customerRef);

  try {
    const res = await fetch(url.toString(), { method: 'GET', mode: 'cors', credentials: 'omit' });
    if (!res.ok) return [];
    const body = (await res.json()) as unknown;
    const rows = (body as { conversations?: unknown })?.conversations;
    if (!Array.isArray(rows)) return [];
    const out: VisitorConversation[] = [];
    for (const raw of rows.slice(0, CONVERSATIONS_CAP)) {
      const row = readRow(raw);
      if (row) out.push(row);
    }
    return out;
  } catch {
    return [];
  }
}

/** One turn as the wire carries it. Deliberately NOT the store's `Message`:
 *  this module is a wire adapter and must not reach into the store for a type
 *  (the store already imports from here, so that would be a cycle) nor mint ids,
 *  which is the store's job. */
export interface WireTurn {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

/** One conversation's turns, oldest-first. `null` on any failure.
 *
 *  `null` and `[]` mean DIFFERENT things and the caller must not conflate them:
 *  null is "could not ask" (offline, or a 404 on a stale pointer) and the caller
 *  keeps whatever it had; [] is the server saying this thread is genuinely empty.
 *
 *  Roles are widened server-side beyond user|assistant — an owner typing and the
 *  system explaining itself both appear — so anything that is not the visitor's
 *  own line is folded onto the assistant side rather than dropped. A thread that
 *  silently omitted the human's replies would be worse than no history at all. */
export async function fetchConversationMessages(
  config: ConversationsConfig,
  customerRef: string,
  conversationId: string,
): Promise<WireTurn[] | null> {
  if (!conversationId) return null;
  const url = new URL(
    `${config.endpoint}/paw-bar/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
  url.searchParams.set('w', config.widgetId);
  url.searchParams.set('key', config.signedKey);
  url.searchParams.set('customer_ref', customerRef);

  try {
    const res = await fetch(url.toString(), { method: 'GET', mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const body = (await res.json()) as { messages?: unknown };
    const rows = body?.messages;
    if (!Array.isArray(rows)) return null;
    const out: WireTurn[] = [];
    for (const raw of rows.slice(-MESSAGES_CAP)) {
      const row = raw as { role?: unknown; content?: unknown; created_at?: unknown };
      const content = typeof row.content === 'string' ? row.content : '';
      if (!content) continue;
      out.push({
        role: row.role === 'user' ? 'user' : 'assistant',
        content,
        at: typeof row.created_at === 'string' ? row.created_at : '',
      });
    }
    return out;
  } catch {
    return null;
  }
}

/** Start a fresh conversation. `null` on any failure — the caller keeps the
 *  conversation it had rather than dropping the visitor into a broken state. */
export async function openConversation(
  config: ConversationsConfig,
  customerRef: string,
): Promise<VisitorConversation | null> {
  try {
    const res = await fetch(`${config.endpoint}/paw-bar/conversations`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: config.signedKey,
        w: config.widgetId,
        customer_ref: customerRef,
      }),
    });
    if (!res.ok) return null;
    return readRow(await res.json());
  } catch {
    return null;
  }
}
