// operator.svelte.ts — The poll loop that brings the HUMAN half of the
// conversation into the glass app. Created 2026-07-30 (type-to-takeover,
// slice 2). Sibling of contact.svelte: self-guarded, DOM-free, instantiable in
// a test with a mocked fetch (tests/operator.spec.ts). It owns the transport +
// the cadence only — every message it fetches is handed to the ChatStore,
// which stays the single source of truth for the thread.
//
// Lifecycle (the shell drives it from ONE $effect on the view):
//   * start() while the PANEL is open — the visitor is actually watching.
//     Polls immediately, then every OPERATOR_POLL_MS.
//   * paused while document.hidden — a backgrounded tab burns no requests;
//     returning to the tab fires an immediate catch-up poll.
//   * stop() when the panel closes (✕, Escape, minimize, outside click).
//   * start() is idempotent — a second call never schedules a second interval,
//     and an in-flight latch means requests never stack behind a slow backend.
//
// Idempotent appends: the store tracks a high-water `after` cursor, seeded
// from the RESTORED transcript so a page reload resumes instead of replaying,
// and ChatStore.appendOperator dedupes on derived ids as a second guard for a
// backend that ignores `after` entirely.
//
// Defensive by construction: fetchOperatorMessages returns null for a 404, any
// refusal, a network error or a malformed body, and null is a no-op here — the
// thread, the bot-paused chip and the chat itself behave exactly as they did
// before this file existed. A backend with no /paw-bar/messages endpoint just
// polls into a 404 every few seconds and the visitor never knows.

import { getCustomerRef } from '../lib/customer-ref';
import type { ConciergeChatConfig } from '../lib/chat-client';
import { fetchOperatorMessages, laterAt } from '../lib/operator-poll';
import type { ChatStore } from './chat.svelte';

/** Cadence while the panel is open. Support-chat scale: fast enough that an
 *  owner reply feels live, slow enough to be invisible on the backend. */
export const OPERATOR_POLL_MS = 7000;

export interface OperatorStoreConfig {
  endpoint: string;
  widgetId: string;
  siteKey: string;
}

export class OperatorStore {
  #chat: ChatStore;
  #config: OperatorStoreConfig;
  #timer: ReturnType<typeof setInterval> | null = null;
  #inFlight = false;
  #after = '';
  #customerRef: string | null = null;
  #onVisibility: (() => void) | null = null;

  constructor(chat: ChatStore, config: OperatorStoreConfig) {
    this.#chat = chat;
    this.#config = config;
    // Resume from the newest owner/system turn the restored transcript already
    // holds, so a reload doesn't ask for (and re-append) the whole history.
    this.#after = chat.latestOperatorAt();
  }

  /** Is the loop scheduled? (Panel open + not yet stopped.) */
  get running(): boolean {
    return this.#timer !== null;
  }

  /** The high-water cursor sent as `after` on the next poll. */
  get after(): string {
    return this.#after;
  }

  start(): void {
    if (this.#timer !== null) return; // already running — never double-schedule
    this.#timer = setInterval(() => void this.poll(), OPERATOR_POLL_MS);
    const onVisibility = () => {
      // Catch up the moment the visitor comes back to the tab.
      if (!isHidden()) void this.poll();
    };
    this.#onVisibility = onVisibility;
    try {
      document.addEventListener('visibilitychange', onVisibility);
    } catch {
      /* no document (SSR-ish test env) — the interval alone still works */
    }
    void this.poll();
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    if (this.#onVisibility) {
      try {
        document.removeEventListener('visibilitychange', this.#onVisibility);
      } catch {
        /* ignore */
      }
      this.#onVisibility = null;
    }
  }

  /** One poll. Skipped entirely while the tab is hidden or a request is still
   *  in flight, so requests never stack and a background tab stays quiet. */
  async poll(): Promise<void> {
    if (this.#inFlight || isHidden()) return;
    this.#inFlight = true;
    try {
      const result = await fetchOperatorMessages(await this.#clientConfig(), this.#after);
      // null = 404 / refusal / network error / malformed body. Change nothing.
      if (!result) return;
      this.#chat.botPaused = result.botPaused;
      for (const m of result.messages) this.#after = laterAt(this.#after, m.at);
      this.#chat.appendOperator(result.messages);
    } finally {
      this.#inFlight = false;
    }
  }

  async #clientConfig(): Promise<ConciergeChatConfig> {
    if (!this.#customerRef) this.#customerRef = await getCustomerRef(this.#config.widgetId);
    return {
      endpoint: this.#config.endpoint,
      widgetId: this.#config.widgetId,
      signedKey: this.#config.siteKey,
      customerRef: this.#customerRef,
    };
  }
}

function isHidden(): boolean {
  try {
    return typeof document !== 'undefined' && document.hidden === true;
  } catch {
    return false;
  }
}
