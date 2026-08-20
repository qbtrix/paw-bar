// chat.svelte.ts — Svelte 5 runes store over the concierge SSE contract.
// Updated 2026-08-21 (an empty answer must not erase): #hydrate adopted an empty
// server response over the restored cache, and #persist wrote that emptiness back
// — saveTranscript removes the row when the list is empty — so a visitor's history
// was deleted off their own device on reload whenever the per-conversation read
// came back empty, which it does for reasons unrelated to whether they talked.
// Updated 2026-08-21 (resume the thread): adoptConversation carries the turns
// with the id. A visitor who typed before the conversation list loaded had their
// transcript filed under the ".active" sentinel; adoption took the id, wrote the
// pointer and left the turns behind, so the next reload resumed a conversation
// with an empty row. See lib/transcript.migrateActiveTranscript.
// Updated 2026-07-30 (human takeover): a HUMAN can now join the thread. Message
// grew two roles — 'owner' (the site owner typing from their inbox) and
// 'system' (quiet in-thread notices) — and the store owns three new pieces:
//   * appendOperator() — idempotent append of polled owner/system turns. Ids
//     are DERIVED from (role, at, content) by lib/operator-poll, so a replayed
//     poll and a page reload both land on the same id and nothing duplicates.
//     The first owner turn in a thread also drops a one-time "a member of the
//     team joined" system chip (stable id — it can never double).
//   * botPaused — mirrors the server's conversation state, drives the quiet
//     "you're chatting with the team" chip near the composer. Set by the poll
//     and, immediately, by the human_replying frame.
//   * the human_replying frame — a paused-bot turn produces NO assistant text,
//     which used to trip the clean-but-empty 'No reply.' error path. It is now
//     a legitimate outcome: the empty bubble is dropped, the human-facing line
//     renders as a system chip, and no error is flagged.
// Updated 2026-07-30 (conversation continuity): the constructor rehydrates the
// visitor's persisted thread from lib/transcript (localStorage, per-widget,
// capped + TTL'd) and every turn that reaches a rest state persists — the
// iframe reloads on every host-page navigation, and before this the visitor
// lost the whole conversation walking between pages (the continuity
// Intercom/Crisp/Chatbase provide by default). Same day (quick actions):
// reset() — abort, wipe messages/error, and clear the persisted row — backs
// the panel menu's "New conversation". Same day (sources on replies): Message
// grew an optional `sources` list; the `sources` SSE frame (arrives before
// stream_end) attaches sanitized {title,url} citations to the streaming
// assistant turn, and they persist/restore with the transcript.
// Created 2026-07-15 (A3 glass bar). Single source of truth for the panel:
// messages[], isStreaming, error, and the anonymous customerRef. send(text)
// appends the user turn + a streaming assistant turn, then streams deltas from
// streamConciergeChat into that turn; stop() aborts the in-flight stream via an
// AbortController and finalizes whatever streamed. No DOM, no component
// coupling — it's instantiable directly in a test with a mocked fetch
// (tests/store.spec.ts).

import { streamConciergeChat, type ConciergeChatConfig } from '../lib/chat-client';
import { getCustomerRef } from '../lib/customer-ref';
import { laterAt, operatorMessageId, type OperatorMessage } from '../lib/operator-poll';
import type { Source } from '../lib/sources';
import {
  fetchConversationMessages,
  openConversation,
  type WireTurn,
} from '../lib/conversations-client';
import {
  clearTranscript,
  loadActiveConversationId,
  loadTranscript,
  migrateActiveTranscript,
  migrateLegacyTranscript,
  saveActiveConversationId,
  saveTranscript,
} from '../lib/transcript';

export type MessageStatus = 'streaming' | 'done' | 'error';
/** 'owner' = a human from the site's team; 'system' = a quiet in-thread notice. */
export type MessageRole = 'user' | 'assistant' | 'owner' | 'system';
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  // Optional source citations for an assistant reply (public page titles +
  // urls, already sanitized). Absent when the backend sends none.
  sources?: Source[];
  // Server timestamp on owner/system turns — the operator poll's high-water
  // mark, persisted so a reload resumes from where the visitor left off.
  at?: string;
}

/** Stable id for the one-time "a person joined" chip, so repeat polls and a
 *  page reload can never render it twice. */
export const JOIN_NOTICE_ID = 'pawbar-team-joined';
export const JOIN_NOTICE = 'A member of the team joined the conversation';
/** Fallback for a human_replying frame that arrives without a message. */
export const HUMAN_REPLYING_FALLBACK = 'Someone from the team is replying…';

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
  /** The owner has taken over — the bot is muted for this visitor. Server
   *  state, mirrored here by the operator poll and by the human_replying
   *  frame; the panel shows a quiet chip while it's true. */
  botPaused = $state(false);

  /** Which of this visitor's conversations the panel is showing (2026-08-19).
   *  "" until the server names one, which is a legitimate state: a turn sent
   *  without an id lands on the conversation in progress, so the visitor can
   *  talk before the list has loaded. */
  conversationId = $state('');

  #config: ChatStoreConfig;
  #customerRef: string | null = null;
  #controller: AbortController | null = null;

  constructor(config: ChatStoreConfig) {
    this.#config = config;
    // Continuity across iframe reloads (every host-page navigation reloads the
    // frame): rehydrate the visitor's persisted thread — the Intercom/Crisp
    // pattern. Statuses come back terminal; nothing resumes streaming.
    this.conversationId = loadActiveConversationId(config.widgetId);
    // The CACHE, painted first so the panel is never blank for a frame.
    this.messages = loadTranscript(config.widgetId, this.conversationId);
    // Then the record. See #hydrate.
    void this.#hydrate();
  }

  /** Replace the cached thread with the server's copy.
   *
   *  localStorage is a cache, not the record. It used to be the record, and that
   *  was the bug: this bar is a THIRD-PARTY iframe, so Safari blocks its storage
   *  outright and Chrome and Firefox partition it per top-level site — and the
   *  stored row carries a 7-day TTL on top of that. Any of those losing the
   *  transcript lost the conversation permanently, while the server held every
   *  message the whole time. A visitor came back to an empty panel with their
   *  conversation id still sitting in localStorage, pointing at turns nothing
   *  could load: the pointer has no TTL and the thread does.
   *
   *  Failure-soft, and deliberately only in the direction that cannot lose data.
   *  null means we could not ask — offline, or a 404 on a pointer that has gone
   *  stale — and the cached thread stays on screen.
   *
   *  An empty ARRAY does NOT mean the visitor said nothing, and it used to be
   *  adopted as though it did. Two ways the server answers 200 with nothing for
   *  a conversation that really has turns:
   *
   *    * the messages read finds runs by session_key
   *      `cloud:concierge:<pocket>:<conversation_id>:<agent>`, while the chat
   *      endpoint writes `conversation.id if conversation is not None else
   *      customer_ref`. A turn written while the conversation row was missing
   *      carries the customer_ref spelling and is invisible to that read.
   *    * a site with transcript retention off stores no visitor lines at all
   *      (the endpoint's own `messages or []`).
   *
   *  Adopting that emptiness did not merely blank the panel: #persist writes it
   *  back, and saveTranscript REMOVES the row when the list is empty. So the
   *  widget asked the server a question, was told "nothing" for reasons
   *  unrelated to whether the visitor talked, and deleted their conversation off
   *  their own device — every reload, unrecoverably.
   *
   *  So an empty answer changes nothing now. The cache holding turns is itself
   *  the evidence those turns happened. The cost is that a thread genuinely
   *  cleared server-side lingers locally until its 7-day TTL expires — cosmetic
   *  staleness, weighed against destroying someone's history.
   *
   *  Never clobbers a live exchange: if the visitor has started typing turns
   *  before this lands, theirs win. The fetch is only ever catching up. */
  async #hydrate(): Promise<void> {
    const conversationId = this.conversationId;
    if (!conversationId) return;
    const customerRef = await this.#resolveCustomerRef();
    if (!customerRef) return;
    const turns = await fetchConversationMessages(
      { endpoint: this.#config.endpoint, widgetId: this.#config.widgetId, signedKey: this.#config.siteKey },
      customerRef,
      conversationId,
    );
    if (turns === null) return;
    // Re-read AFTER the await: the visitor may have switched conversations or
    // sent a turn while this was in flight, and a late answer must not land in
    // the wrong thread or overwrite something newer than itself.
    if (this.conversationId !== conversationId) return;
    if (this.isStreaming || this.messages.some((m) => m.status === 'streaming')) return;
    // Nothing to adopt, and adopting nothing DELETES the row (see above).
    if (turns.length === 0) return;
    this.messages = turns.map((turn: WireTurn) => ({
      id: newId(),
      role: turn.role,
      content: turn.content,
      status: 'done' as const,
      ...(turn.at ? { at: turn.at } : {}),
    }));
    this.#persist();
  }

  /** Persist the terminal turns — called whenever a turn reaches a rest state. */
  #persist(): void {
    saveTranscript(this.#config.widgetId, this.messages, this.conversationId);
  }

  /** Adopt the conversation the server named for a thread that predates
   *  conversation identity, carrying its stored turns across ONCE so a visitor
   *  mid-conversation at upgrade does not open the bar to an empty panel. */
  adoptConversation(conversationId: string): void {
    if (!conversationId || this.conversationId) return;
    migrateLegacyTranscript(this.#config.widgetId, conversationId);
    // ...and the row this session built before the list named the conversation.
    // Skipping it is what stranded the turns: the pointer moved to the named
    // conversation, the transcript stayed under the sentinel, and the reload
    // after that opened an empty panel.
    migrateActiveTranscript(this.#config.widgetId, conversationId);
    this.conversationId = conversationId;
    saveActiveConversationId(this.#config.widgetId, conversationId);
    if (this.messages.length === 0) {
      this.messages = loadTranscript(this.#config.widgetId, conversationId);
    } else {
      // The thread already on screen now has a name. File it under that name so
      // the pointer and the row agree even when the migration above had nothing
      // to move (storage blocked, or the turns only ever existed in memory).
      this.#persist();
    }
  }

  /** Walk into one of the visitor's other conversations (the Messages tab).
   *  Aborts anything in flight first, so a reply streaming into the thread the
   *  visitor just left can never land in the one they opened. */
  switchTo(conversationId: string): void {
    if (!conversationId || conversationId === this.conversationId) return;
    const controller = this.#controller;
    this.#controller = null;
    controller?.abort();
    this.isStreaming = false;
    this.error = null;
    this.conversationId = conversationId;
    // Cache first so the panel switches instantly, then the record — the same
    // two-step the constructor does. Walking into an old thread from the Messages
    // tab is in fact the MOST likely place to hold nothing locally: the cache is
    // written per conversation, and the visitor is by definition opening one they
    // have not been in recently.
    this.messages = loadTranscript(this.#config.widgetId, conversationId);
    saveActiveConversationId(this.#config.widgetId, conversationId);
    void this.#hydrate();
  }

  async #resolveCustomerRef(): Promise<string> {
    if (this.#customerRef) return this.#customerRef;
    this.#customerRef = await getCustomerRef(this.#config.widgetId);
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
    // Set by the human_replying frame: this turn legitimately produces no
    // assistant text because a person is answering instead.
    let humanReplying = false;

    const customerRef = await this.#resolveCustomerRef();
    const clientConfig: ConciergeChatConfig = {
      endpoint: this.#config.endpoint,
      widgetId: this.#config.widgetId,
      signedKey: this.#config.siteKey,
      customerRef,
      conversationId: this.conversationId,
    };

    await streamConciergeChat(
      clientConfig,
      message,
      {
        onChunk: (delta) => {
          const m = this.#assistant(assistantId);
          if (m) m.content += delta;
        },
        onSources: (sources) => {
          // Arrives (at most once) before stream_end; persisted by onEnd.
          const m = this.#assistant(assistantId);
          if (m) m.sources = sources;
        },
        onHumanReplying: (line) => {
          // The owner has taken over: the bot stays silent by design. Drop the
          // empty assistant bubble, mark the conversation paused, and say so
          // in-thread — silence is what would read as a broken widget.
          humanReplying = true;
          this.botPaused = true;
          const m = this.#assistant(assistantId);
          if (m && !m.content) this.messages = this.messages.filter((x) => x.id !== assistantId);
          else if (m) m.status = 'done';
          this.#appendSystem(line || HUMAN_REPLYING_FALLBACK);
        },
        onEnd: (info) => {
          // Keep whatever streamed. If nothing streamed: a user stop() and a
          // paused bot both drop the empty bubble silently; only a genuinely
          // clean-but-empty server reply flags an error.
          const m = this.#assistant(assistantId);
          if (m) {
            if (m.content) m.status = 'done';
            else if (info.cancelled || humanReplying) {
              this.messages = this.messages.filter((x) => x.id !== assistantId);
            } else {
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

  /** Append polled owner/system turns, skipping any the thread already holds.
   *  Idempotent twice over: ids are derived from (role, at, content), and ids
   *  survive the persisted transcript — so repeat polls AND a page reload both
   *  land on the same rows. Returns how many turns were actually appended. */
  appendOperator(messages: OperatorMessage[]): number {
    let appended = 0;
    for (const incoming of messages) {
      const id = operatorMessageId(incoming);
      if (this.messages.some((m) => m.id === id)) continue;
      if (incoming.role === 'owner') this.#ensureJoinNotice(incoming.at);
      this.messages.push({
        id,
        role: incoming.role,
        content: incoming.content,
        status: 'done',
        at: incoming.at,
      });
      appended += 1;
    }
    if (appended > 0) this.#persist();
    return appended;
  }

  /** Newest owner/system timestamp already in the thread — the seed for the
   *  poll's `after` cursor after a reload restored the transcript. */
  latestOperatorAt(): string {
    let out = '';
    for (const m of this.messages) {
      if ((m.role === 'owner' || m.role === 'system') && m.at) out = laterAt(out, m.at);
    }
    return out;
  }

  /** One quiet "a person joined" chip, before the FIRST owner turn only. */
  #ensureJoinNotice(at: string): void {
    if (this.messages.some((m) => m.id === JOIN_NOTICE_ID || m.role === 'owner')) return;
    this.messages.push({ id: JOIN_NOTICE_ID, role: 'system', content: JOIN_NOTICE, status: 'done', at });
  }

  /** Push a system chip, once per takeover episode. Scanning back past the
   *  visitor's and the bot's turns: an identical notice already standing means
   *  skip (a visitor sending three messages into a paused bot gets ONE chip,
   *  not three), while an owner turn in between means the human has since
   *  spoken, so the notice is worth saying again. */
  #appendSystem(text: string): void {
    const content = text.trim();
    if (!content) return;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role === 'owner') break;
      if (m.role === 'system' && m.content === content) return;
    }
    this.messages.push({ id: newId(), role: 'system', content, status: 'done' });
  }

  stop(): void {
    // Aborts the fetch/reader; chat-client routes the AbortError to onEnd,
    // which finalizes the assistant turn and clears isStreaming.
    this.#controller?.abort();
  }

  /** Start over: drop the thread AND its persisted row (quick actions "New
   *  conversation"). Aborts any in-flight stream first; #controller is nulled
   *  before the abort's async onEnd fires, so #finish's identity guard makes
   *  the late callback a no-op against the fresh state. botPaused is left
   *  ALONE on purpose: whether the owner has taken over is server state keyed
   *  to this visitor, and wiping the local thread doesn't hand the bot back. */
  async reset(): Promise<void> {
    const controller = this.#controller;
    this.#controller = null;
    controller?.abort();

    // Tell the SERVER, not just localStorage. Before 2026-08-19 this method
    // only wiped the local row, so "New conversation" was a lie the widget told
    // itself: the backend kept appending to the same conversation and kept
    // replaying the abandoned thread into the agent. Retiring it server-side is
    // what actually makes the next turn start cold.
    const previous = this.conversationId;
    const opened = await openConversation(
      {
        endpoint: this.#config.endpoint,
        widgetId: this.#config.widgetId,
        signedKey: this.#config.siteKey,
      },
      await this.#resolveCustomerRef(),
    );

    this.messages = [];
    this.error = null;
    this.isStreaming = false;
    // The old conversation's turns stay on the device: it is now a row in the
    // visitor's Messages list, and clearing it would empty a conversation they
    // can still open. Only a FAILED open clears, because then there is no new
    // conversation and the local thread would otherwise reattach to the old one.
    if (opened) {
      this.conversationId = opened.id;
      saveActiveConversationId(this.#config.widgetId, opened.id);
    } else {
      this.conversationId = '';
      saveActiveConversationId(this.#config.widgetId, '');
      clearTranscript(this.#config.widgetId, previous);
    }
  }

  #finish(controller: AbortController): void {
    // Guard against a late callback from a superseded stream flipping state.
    if (this.#controller !== controller) return;
    this.isStreaming = false;
    this.#controller = null;
  }
}
