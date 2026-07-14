// chat-client.ts — Streaming HTTP client for the Paw Bar concierge chat. Sibling
// of client.ts: one fetch, credentials omitted, CORS mode, no retry. POSTs the
// visitor message to POST {endpoint}/paw-bar/chat and reads the text/event-stream
// response incrementally via a ReadableStream reader, handing decoded chunks to
// the pure sse.ts parser and routing frames to onChunk / onEnd / onError.
// Created: 2026-07-14 (Paw Bar chat UI, T4) — request body + SSE frames match the
//   source of truth ee/pocketpaw_ee/paw_bar/router.py::concierge_chat: body
//   {widget_id, signed_key, customer_ref, message}; frames `message.persisted`
//   (ignored), `chunk` {content,type} (delta appended), `stream_end` (finalize),
//   plus `error`/`interrupted` terminal states. The browser sends Origin itself;
//   the backend origin-gates on it.

import { createSseParser, type SseFrame } from './sse';

export interface ConciergeChatConfig {
  endpoint: string;
  widgetId: string;
  signedKey: string;
  customerRef: string;
}

export interface ChatCallbacks {
  // A streamed token delta for the current assistant reply.
  onChunk: (delta: string) => void;
  // The reply finished cleanly (stream_end frame).
  onEnd: (info: { assistant_message_id?: string; cancelled?: boolean }) => void;
  // A transport/network/HTTP error, or a server `error`/`interrupted` frame.
  onError: (message: string) => void;
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

// Route one parsed frame to the callbacks. Returns false when the frame is
// terminal (the caller stops reading). Pure — no DOM, no fetch — so the event
// routing is unit-testable alongside the parser.
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
      const message = data && typeof data.message === 'string' ? data.message : 'stream error';
      cb.onError(message);
      return false;
    }
    case 'interrupted':
      cb.onError('The reply was interrupted.');
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
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(chatUrl(config.endpoint), {
      method: 'POST',
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        widget_id: config.widgetId,
        signed_key: config.signedKey,
        customer_ref: config.customerRef,
        message,
      }),
    });
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : String(err));
    return;
  }

  if (!res.ok || !res.body) {
    callbacks.onError(`paw-bar chat failed (${res.status})`);
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
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : String(err));
  }
}
