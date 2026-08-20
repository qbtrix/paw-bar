// conversations.svelte.ts — the visitor's own conversation list (Messages tab).
// Created 2026-08-19 (Messenger). This store did not and could not exist
// before: the backend keyed conversations on (widget_id, customer_ref) with a
// UNIQUE over the pair, so a visitor had exactly one conversation per widget
// forever and there was nothing to list.
//
// Deliberately thin. It owns WHICH conversations exist and which one is open;
// the ChatStore owns the turns inside one. They are kept in sync at exactly one
// seam (`syncActive`) rather than by watching each other, because two stores
// with effects pointing at each other is how a "which conversation am I in"
// bug gets written.
//
// Every read degrades to the list it already has. A Messages tab that cannot
// refresh shows what it last knew, which is far better than emptying itself in
// front of someone mid-conversation.

import {
  fetchConversations,
  openConversation,
  type VisitorConversation,
} from '../lib/conversations-client';
import { getCustomerRef } from '../lib/customer-ref';

export interface ConversationsConfig {
  endpoint: string;
  widgetId: string;
  siteKey: string;
}

export class ConversationsStore {
  items = $state<VisitorConversation[]>([]);
  /** True only for the FIRST load, so the tab shows a skeleton once rather than
   *  flashing one over a list the visitor is already reading. */
  loading = $state(false);
  loaded = $state(false);

  #config: ConversationsConfig;
  #customerRef: string | null = null;
  #inFlight = false;

  constructor(config: ConversationsConfig) {
    this.#config = config;
  }

  get clientConfig() {
    return {
      endpoint: this.#config.endpoint,
      widgetId: this.#config.widgetId,
      signedKey: this.#config.siteKey,
    };
  }

  async #ref(): Promise<string> {
    if (this.#customerRef) return this.#customerRef;
    this.#customerRef = await getCustomerRef(this.#config.widgetId);
    return this.#customerRef;
  }

  /** The conversation the server considers in progress, or "" if there is none
   *  yet (a visitor who has never sent a turn). */
  get activeId(): string {
    return this.items.find((c) => c.active)?.id ?? '';
  }

  /** Refresh the list. Latched: the tab mounts, the panel opens and a turn
   *  finishes at nearly the same moment, and three overlapping fetches would
   *  render whichever resolved last rather than whichever is newest. */
  async refresh(): Promise<void> {
    if (this.#inFlight) return;
    this.#inFlight = true;
    if (!this.loaded) this.loading = true;
    try {
      const rows = await fetchConversations(this.clientConfig, await this.#ref());
      // An empty answer from a failed read must not erase a list the visitor is
      // looking at. Only an empty answer we KNOW is real (we have loaded before
      // and this is a genuine zero) is allowed to clear it — and the client
      // returns [] for both, so the safe reading is to keep what we have.
      if (rows.length > 0 || !this.loaded) this.items = rows;
      this.loaded = true;
    } catch {
      // "Every read degrades to the list it already has" is this store's stated
      // contract, and try/finally alone did not deliver it: a throw from the
      // client escaped as an unhandled rejection and took the caller's
      // openPanel() with it. That is not hypothetical — fetchConversations built
      // its URL with `new URL()` outside its own try, and threw on the relative
      // endpoint the frame seeds, on every deployed bar. Keep whatever list we
      // already have; a Messages tab that cannot refresh should show what it
      // last knew.
    } finally {
      this.loading = false;
      this.#inFlight = false;
    }
  }

  /** Start a new conversation and put it at the head of the list.
   *  Returns its id, or "" if the server refused — the caller then keeps the
   *  conversation it had rather than stranding the visitor in a nameless one. */
  async open(): Promise<string> {
    const opened = await openConversation(this.clientConfig, await this.#ref());
    if (!opened) return '';
    this.items = [opened, ...this.items.map((c) => ({ ...c, active: false }))];
    return opened.id;
  }

  /** Mark `conversationId` as the one in progress locally, without a round trip.
   *  The server already agrees — it is the one turns are being sent against —
   *  so this only keeps the list's own `active` flags honest between refreshes. */
  syncActive(conversationId: string): void {
    if (!conversationId) return;
    if (!this.items.some((c) => c.id === conversationId)) return;
    this.items = this.items.map((c) => ({ ...c, active: c.id === conversationId }));
  }
}
