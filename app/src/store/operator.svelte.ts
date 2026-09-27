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
//
// 2026-09-27 (paw-bar states B8, "team" activity on a closed bar): startClosed()
// adds a SLOW loop for while the bar is closed, so a team message written then
// can light the pill. Every 30s, and only while the conversation is one a person
// is in (botPaused, or an owner turn in the last 24h) — otherwise the tick does
// nothing. Same hidden-tab pause and catch-up. start() switches it back to the
// 7s loop. Additive: start()/stop() behave exactly as before for the open panel,
// and nothing calls startClosed() until the new bar wires it.

import { getCustomerRef } from '../lib/customer-ref';
import type { ConciergeChatConfig } from '../lib/chat-client';
import { fetchOperatorMessages, laterAt } from '../lib/operator-poll';
import type { ChatStore } from './chat.svelte';

/** Cadence while the panel is open. Support-chat scale: fast enough that an
 *  owner reply feels live, slow enough to be invisible on the backend. */
export const OPERATOR_POLL_MS = 7000;
/** Cadence while the bar is closed and a person is in the conversation. */
export const OPERATOR_CLOSED_POLL_MS = 30_000;
/** An owner turn this recent keeps the closed-bar loop polling. */
const RECENT_OWNER_MS = 24 * 60 * 60 * 1000;

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
  /** The conversation `#after` was accumulated against, so a switch can reset
   *  it. Starts as the constructor's conversation rather than '' so the first
   *  poll of an ordinary session doesn't discard the cursor restored from the
   *  transcript and re-append the whole thread. */
  #polledConversationId: string;
  #customerRef: string | null = null;
  #onVisibility: (() => void) | null = null;
  #closed = false;

  constructor(chat: ChatStore, config: OperatorStoreConfig) {
    this.#chat = chat;
    this.#config = config;
    // Resume from the newest owner/system turn the restored transcript already
    // holds, so a reload doesn't ask for (and re-append) the whole history.
    this.#after = chat.latestOperatorAt();
    this.#polledConversationId = chat.conversationId;
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
    if (this.#timer !== null && !this.#closed) return; // already running — never double-schedule
    this.stop(); // the closed-bar loop, if that is what is running
    this.#schedule(false, OPERATOR_POLL_MS);
    void this.poll();
  }

  /** The bar closed: keep a slow loop that only polls while a person is in the
   *  conversation. No immediate poll — the open loop has just run. */
  startClosed(): void {
    if (this.#timer !== null && this.#closed) return;
    this.stop();
    this.#schedule(true, OPERATOR_CLOSED_POLL_MS);
  }

  #schedule(closed: boolean, ms: number): void {
    this.#closed = closed;
    const tick = () => {
      if (!this.#closed || this.#watched()) void this.poll();
    };
    this.#timer = setInterval(tick, ms);
    const onVisibility = () => {
      // Catch up the moment the visitor comes back to the tab.
      if (!isHidden()) tick();
    };
    this.#onVisibility = onVisibility;
    try {
      document.addEventListener('visibilitychange', onVisibility);
    } catch {
      /* no document (SSR-ish test env) — the interval alone still works */
    }
  }

  /** Is a person in this conversation? A takeover, or an owner turn in the last 24h. */
  #watched(): boolean {
    if (this.#chat.botPaused) return true;
    const cutoff = Date.now() - RECENT_OWNER_MS;
    return this.#chat.messages.some((m) => m.role === 'owner' && !!m.at && Date.parse(m.at) >= cutoff);
  }

  stop(): void {
    this.#closed = false;
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
    // The `after` cursor belongs to ONE conversation. Walking back into an older
    // thread from the Messages tab carries a high-water mark from a newer one,
    // which would filter out every line in the thread just opened — a takeover
    // that silently shows nothing. Re-seed from the transcript now on screen.
    const conversationId = this.#chat.conversationId;
    if (conversationId !== this.#polledConversationId) {
      this.#polledConversationId = conversationId;
      this.#after = this.#chat.latestOperatorAt();
    }
    this.#inFlight = true;
    try {
      const result = await fetchOperatorMessages(
        await this.#clientConfig(),
        this.#after,
        undefined,
        // Read fresh each poll rather than captured at construction: the visitor
        // can switch conversations from the Messages tab mid-loop, and a
        // captured id would keep delivering the old thread's owner replies into
        // the new one.
        this.#chat.conversationId,
      );
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
