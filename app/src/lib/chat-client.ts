// chat-client.ts — Streaming HTTP client for the Paw Bar concierge chat. One
// fetch, credentials omitted, CORS mode, no retry. POSTs the visitor message to
// POST {endpoint}/paw-bar/chat and reads the text/event-stream response
// incrementally, handing decoded chunks to the pure sse.ts parser and routing
// frames to the callbacks (dispatchFrame, pure + unit-tested). Request body and
// frames match ee/pocketpaw_ee/paw_bar/router.py::concierge_chat.
//
// Request body: {widget_id, signed_key, customer_ref, message,
// conversation_id?, page?, tz?}. Optional keys are left off, never sent as
// null; older servers ignore unknown keys (pydantic extra='ignore').
//   * page — the host page the bar is embedded on (lib/host-page: origin +
//     pathname, title clipped to 120).
//   * tz — the visitor's IANA timezone (visitorTimeZone), so the concierge can
//     talk about times, and booking slots, in the visitor's own clock. Sent
//     only when it looks like a real zone name.
//
// Frames: `chunk` (text deltas only; typed non-text chunks never reach a
// public reply), `stream_end`, optional `sources` ({sources:[…]} or the v2
// {items:[…]}, both through lib/sources), optional `action` ({action:{do, to?,
// target?, label}}, at most one, before stream_end, through
// lib/page-actions.sanitizeAction), `human_replying` (owner took over; not
// terminal), `unavailable` (the server could not answer: {reason:
// "temporary"|"limit"}, unknown reasons read as temporary; terminal, the
// stream_end after it is not read), and `error` / `interrupted`. A body that
// ends without a
// terminal frame still finalizes with onEnd({}).
//
// Failures reach onError as a structured RawFailure (lib/chat-errors), never
// display text: a non-ok response carries its status, JSON `detail` and
// `retry-after`; a fetch rejection reports navigator.onLine (offline vs
// unreachable); a read rejection is `afterResponse` (a cut-off reply, never
// auto-resent). An AbortSignal (stop()) finalizes as onEnd({cancelled:true}).

import { createSseParser, type SseFrame } from './sse';
import { sanitizeSources, type Source } from './sources';
import type { RawFailure } from './chat-errors';
import { getHostPage } from './host-page';
import { sanitizeAction, type PageAction } from './page-actions';

export interface ConciergeChatConfig {
  endpoint: string;
  widgetId: string;
  signedKey: string;
  customerRef: string;
  /** Which of this visitor's conversations the turn belongs to (2026-08-19).
   *  Omitted or "" means "the one in progress", which the server resolves — the
   *  same thing a widget bundle built before conversations had identities
   *  sends, so the field stays optional on the wire too. */
  conversationId?: string;
}

export interface ChatCallbacks {
  // A streamed token delta for the current assistant reply.
  onChunk: (delta: string) => void;
  // The reply finished cleanly (stream_end frame) or was cancelled by stop().
  onEnd: (info: { assistant_message_id?: string; cancelled?: boolean }) => void;
  // A transport/network/HTTP error, or a server `error`/`interrupted` frame.
  // Structured, never display text: lib/chat-errors classifies it.
  onError: (raw: RawFailure) => void;
  // Optional: the reply's source citations (`sources` frame, before
  // stream_end). Absent frame or absent callback — nothing happens.
  onSources?: (sources: Source[]) => void;
  // Optional: the one page action the reply suggests (`action` frame, before
  // stream_end), already sanitized. Run only after the reply ends.
  onAction?: (action: PageAction) => void;
  // Optional: a human has taken over, so this turn carries no assistant text
  // (`human_replying` frame). The line is customer-facing copy; '' when the
  // frame omits it.
  onHumanReplying?: (message: string) => void;
}

const IANA_ZONE = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;

/** The visitor's IANA timezone (e.g. "Europe/Amsterdam"), or null when the
 *  runtime reports none or something that isn't a plausible zone name. */
export function visitorTimeZone(zone?: unknown): string | null {
  let tz = zone;
  if (tz === undefined) {
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }
  if (typeof tz !== 'string' || tz.length > 64 || !IANA_ZONE.test(tz)) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

function chatUrl(endpoint: string): string {
  return `${endpoint.replace(/\/$/, '')}/paw-bar/chat`;
}

function safeParse(data: string): Record<string, unknown> | null {
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError' : (err as { name?: string })?.name === 'AbortError';
}

// Route one parsed frame to the callbacks. Returns false when the frame is
// terminal (the caller stops reading). Pure — no DOM, no fetch — so the event
// routing is unit-testable alongside the parser. Copied verbatim from T4.
export function dispatchFrame(frame: SseFrame, cb: ChatCallbacks): boolean {
  switch (frame.event) {
    case 'chunk': {
      const data = safeParse(frame.data);
      const content = data && typeof data.content === 'string' ? data.content : '';
      // The pilot streams plain text. Append text deltas only — an explicitly
      // non-text chunk (e.g. type:"thinking") must not leak into a public reply.
      // Untyped chunks are treated as text (the run's text frames carry
      // type:"text"; T5's live smoke confirms the taxonomy end-to-end).
      const type = data && typeof data.type === 'string' ? data.type : 'text';
      if (content && type === 'text') cb.onChunk(content);
      return true;
    }
    case 'stream_end': {
      const data = safeParse(frame.data) ?? {};
      cb.onEnd({
        assistant_message_id:
          typeof data.assistant_message_id === 'string' ? data.assistant_message_id : undefined,
        cancelled: typeof data.cancelled === 'boolean' ? data.cancelled : undefined,
      });
      return false;
    }
    case 'error': {
      const data = safeParse(frame.data);
      // Logged for the owner, never shown: it can be a provider error.
      const message = data && typeof data.message === 'string' ? data.message : undefined;
      cb.onError({ source: 'frame', event: 'error', message });
      return false;
    }
    case 'sources': {
      // Optional citations for the current reply. Sanitized (strings only,
      // http(s) only, capped) — a malformed frame degrades to no sources.
      const data = safeParse(frame.data);
      // v2 servers name the list `items` ({id,title,url}); `id` is dropped.
      const sources = sanitizeSources(data?.sources ?? data?.items);
      if (sources.length > 0) cb.onSources?.(sources);
      return true;
    }
    case 'action': {
      const action = sanitizeAction(safeParse(frame.data)?.action);
      if (action) cb.onAction?.(action);
      return true;
    }
    case 'human_replying': {
      // The owner took the conversation over — the bot deliberately stays
      // silent. Non-terminal: stream_end still closes the turn.
      const data = safeParse(frame.data);
      const message = data && typeof data.message === 'string' ? data.message.trim() : '';
      cb.onHumanReplying?.(message);
      return true;
    }
    case 'unavailable': {
      const data = safeParse(frame.data);
      cb.onError({ source: 'frame', event: 'unavailable', reason: data?.reason === 'limit' ? 'limit' : 'temporary' });
      return false;
    }
    case 'interrupted':
      cb.onError({ source: 'frame', event: 'interrupted' });
      return false;
    default:
      // message.persisted, unknown events, ping heartbeats — nothing to render.
      return true;
  }
}

export async function streamConciergeChat(
  config: ConciergeChatConfig,
  message: string,
  callbacks: ChatCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const page = getHostPage();
  const tz = visitorTimeZone();
  let res: Response;
  try {
    res = await fetch(chatUrl(config.endpoint), {
      method: 'POST',
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        widget_id: config.widgetId,
        signed_key: config.signedKey,
        customer_ref: config.customerRef,
        message,
        ...(config.conversationId ? { conversation_id: config.conversationId } : {}),
        ...(page ? { page } : {}),
        ...(tz ? { tz } : {}),
      }),
    });
  } catch (err) {
    // A stop() before the response landed — finalize as a cancel, not an error.
    if (isAbort(err)) {
      callbacks.onEnd({ cancelled: true });
      return;
    }
    // No status, no body: offline, DNS, or a response that lost its CORS
    // headers. Only onLine === false proves offline.
    callbacks.onError({ source: 'network', online: isOnline(), afterResponse: false });
    return;
  }

  if (!res.ok || !res.body) {
    callbacks.onError({
      source: 'http',
      status: res.status,
      detail: await readDetail(res),
      retryAfter: res.headers?.get?.('retry-after') ?? null,
    });
    return;
  }

  const parser = createSseParser();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
        if (!dispatchFrame(frame, callbacks)) return; // terminal frame — stop
      }
    }
    // The body ended without a terminal frame (a proxy cutting the stream, a
    // backend that just hangs up after human_replying). Finalize anyway —
    // otherwise the composer stays stuck in its streaming state forever.
    callbacks.onEnd({});
  } catch (err) {
    // stop() aborted mid-stream — keep whatever streamed and finalize as cancel.
    if (isAbort(err)) {
      callbacks.onEnd({ cancelled: true });
      return;
    }
    // The response had started: whatever streamed stays, and this turn is
    // never resent automatically (the model may already have answered).
    callbacks.onError({ source: 'network', online: isOnline(), afterResponse: true });
  }
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** The refusal code from FastAPI's `{"detail": "<code>"}` body, or null. */
async function readDetail(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as { detail?: unknown } | null;
    return data && typeof data.detail === 'string' ? data.detail : null;
  } catch {
    return null;
  }
}
