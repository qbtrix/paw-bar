// chat.svelte.ts — Svelte 5 runes store over the concierge SSE contract.
// Updated 2026-07-30 (conversation continuity): the constructor rehydrates the
// visitor's persisted thread from lib/transcript (localStorage, per-widget,
// capped + TTL'd) and every turn that reaches a rest state persists — the
// iframe reloads on every host-page navigation, and before this the visitor
// lost the whole conversation walking between pages (the continuity
// Intercom/Crisp/Chatbase provide by default).
// Created 2026-07-15 (A3 glass bar). Single source of truth for the panel:
// messages[], isStreaming, error, and the anonymous customerRef. send(text)
// appends the user turn + a streaming assistant turn, then streams deltas from
// streamConciergeChat into that turn; stop() aborts the in-flight stream via an
// AbortController and finalizes whatever streamed. No DOM, no component
// coupling — it's instantiable directly in a test with a mocked fetch
// (tests/store.spec.ts).

import { streamConciergeChat, type ConciergeChatConfig } from '../lib/chat-client';
import { getCustomerRef } from '../lib/customer-ref';
import { loadTranscript, saveTranscript } from '../lib/transcript';

export type MessageStatus = 'streaming' | 'done' | 'error';
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
}

export interface ChatStoreConfig {
  endpoint: string;
  widgetId: string;
  siteKey: string;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class ChatStore {
  messages = $state<Message[]>([]);
  isStreaming = $state(false);
  error = $state<string | null>(null);

  #config: ChatStoreConfig;
  #customerRef: string | null = null;
  #controller: AbortController | null = null;

  constructor(config: ChatStoreConfig) {
    this.#config = config;
    // Continuity across iframe reloads (every host-page navigation reloads the
    // frame): rehydrate the visitor's persisted thread — the Intercom/Crisp
    // pattern. Statuses come back terminal; nothing resumes streaming.
    this.messages = loadTranscript(config.widgetId);
  }

  /** Persist the terminal turns — called whenever a turn reaches a rest state. */
  #persist(): void {
    saveTranscript(this.#config.widgetId, this.messages);
  }

  async #resolveCustomerRef(): Promise<string> {
    if (this.#customerRef) return this.#customerRef;
    this.#customerRef = await getCustomerRef();
    return this.#customerRef;
  }

  async send(text: string): Promise<void> {
    const message = text.trim();
    if (!message || this.isStreaming) return;

    this.error = null;
    // Track the assistant turn by id, never by a captured object reference:
    // $state wraps pushed objects in proxies with a distinct identity, so a
    // captured plain ref both fails === checks AND bypasses reactivity. We
    // always mutate through the reactive array via #assistant(id).
    const assistantId = newId();
    this.messages.push({ id: newId(), role: 'user', content: message, status: 'done' });
    this.messages.push({ id: assistantId, role: 'assistant', content: '', status: 'streaming' });
    this.isStreaming = true;
    // Persist the user turn immediately — a navigation mid-stream keeps the
    // question even when the answer is lost.
    this.#persist();

    const controller = new AbortController();
    this.#controller = controller;

    const customerRef = await this.#resolveCustomerRef();
    const clientConfig: ConciergeChatConfig = {
      endpoint: this.#config.endpoint,
      widgetId: this.#config.widgetId,
      signedKey: this.#config.siteKey,
      customerRef,
    };

    await streamConciergeChat(
      clientConfig,
      message,
      {
        onChunk: (delta) => {
          const m = this.#assistant(assistantId);
          if (m) m.content += delta;
        },
        onEnd: (info) => {
          // Keep whatever streamed. If nothing streamed: a user stop() drops the
          // empty bubble silently; a clean-but-empty server reply flags an error.
          const m = this.#assistant(assistantId);
          if (m) {
            if (m.content) m.status = 'done';
            else if (info.cancelled) this.messages = this.messages.filter((x) => x.id !== assistantId);
            else {
              m.status = 'error';
              this.error = 'No reply.';
            }
          }
          this.#finish(controller);
          this.#persist();
        },
        onError: (msg) => {
          const m = this.#assistant(assistantId);
          if (m) m.status = 'error';
          this.error = msg;
          this.#finish(controller);
          this.#persist();
        },
      },
      controller.signal,
    );
  }

  /** Look up the streaming assistant turn by id and return the REACTIVE array
   *  element (a $state proxy), so mutating it fires reactivity for the UI. */
  #assistant(id: string): Message | undefined {
    return this.messages.find((m) => m.id === id);
  }

  stop(): void {
    // Aborts the fetch/reader; chat-client routes the AbortError to onEnd,
    // which finalizes the assistant turn and clears isStreaming.
    this.#controller?.abort();
  }

  #finish(controller: AbortController): void {
    // Guard against a late callback from a superseded stream flipping state.
    if (this.#controller !== controller) return;
    this.isStreaming = false;
    this.#controller = null;
  }
}
