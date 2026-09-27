// chat.svelte.ts — Svelte 5 runes store over the concierge SSE contract.
// Updated 2026-09-27 (paw-bar states: failures, C5, C2, C11; specs
// docs/design/drafts/2026-09-27-paw-bar-states-ux-failures.md §10 and
// ...-ux-conversation.md). The raw `error` string is GONE: it carried transport
// text ("paw-bar chat failed (429)", "Failed to fetch") that the old shell
// printed to visitors. In its place:
//   * per-turn failures live on the message (`status:'error'` + `failure`, a
//     lib/chat-errors FailureKind); the UI derives copy from FAILURE_COPY;
//   * bar-level `unavailable` (a ChatFailure, in memory only, so a fixed
//     misconfiguration unlocks on the next page load), and `notice`, the ONE
//     near-input line, derived by priority unavailable > rejected > offline >
//     cooldown > takeover > waiting;
//   * `online` + an offline queue: a send while offline becomes a `queued`
//     user turn (max OFFLINE_QUEUE_CAP, persisted with the transcript) and is
//     flushed in order on the window `online` event, one at a time. A turn
//     whose response had started is `interrupted` and never auto-resent;
//   * `cooldownUntil` after a 429 (Retry-After or 30s, doubling on a repeat
//     within 60s, max 60s); Send and Retry are refused until it passes;
//   * send() returns a SendResult — a rejected message (400 message_rejected)
//     is removed from the thread and handed back as `restoreDraft`;
//   * retry(id) re-sends the same user text reusing its bubble, replacing a
//     failed assistant turn with a fresh streaming one;
//   * requestHuman() (POST /paw-bar/request-human) and `handoff`, persisted
//     per conversation, cleared by the first sign a person has taken over;
//   * `Message.stopped` (a reply the visitor stopped with partial text) and
//     `hydrating` (true while #hydrate runs over an empty thread).
// botPaused became an accessor so the operator poll setting it also clears the
// pending handoff. dispose() drops the window online/offline listeners.
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
import {
  classifyError,
  CONTACT_OFFER,
  DEFAULT_COOLDOWN_MS,
  FAILURE_COPY,
  formatCopy,
  MAX_COOLDOWN_MS,
  OFFLINE_QUEUE_FULL,
  reportFailure,
  type ChatFailure,
  type FailureKind,
  type RawFailure,
} from '../lib/chat-errors';
import { postRequestHuman } from '../lib/handoff-client';
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
  loadHandoff,
  loadTranscript,
  migrateActiveTranscript,
  migrateLegacyTranscript,
  saveActiveConversationId,
  saveHandoff,
  saveTranscript,
} from '../lib/transcript';

/** 'queued' = sent while offline; the server has not seen it yet. */
export type MessageStatus = 'queued' | 'streaming' | 'done' | 'error';
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
  // Why a turn with status 'error' failed. On the USER turn for a send that
  // never got an answer (unreachable, rate_limited, unavailable); on the
  // ASSISTANT turn when the reply itself broke (interrupted, server, empty).
  failure?: FailureKind;
  // The visitor pressed Stop and the reply kept its partial text (C5).
  stopped?: boolean;
}

/** The one line near the input. `action: 'contact'` = offer "Leave your email". */
export type NoticeKind = 'unavailable' | 'rejected' | 'offline' | 'cooldown' | 'takeover' | 'waiting';
export interface Notice {
  kind: NoticeKind;
  text: string;
  action?: 'contact';
}

/** 'busy' = nothing was attempted (empty text, or a reply still streaming). */
export type SendResult = { ok: true } | { ok: false; kind: FailureKind | 'busy'; restoreDraft?: string };

export type HandoffError = 'invalid_email' | 'rejected' | 'already_asked' | 'unreachable' | 'unavailable';
/** `waiting` = the conversation really was queued for a person (state
 *  needs_human); false on the partial success where only the record landed. */
export type HandoffResult = { ok: true; waiting: boolean } | { ok: false; error: HandoffError; text: string };

export const OFFLINE_QUEUE_CAP = 5;
export const TAKEOVER_NOTICE = "You're chatting with the team";
export const WAITING_NOTICE = 'Waiting for someone from the team. You can keep chatting meanwhile.';
export const HANDOFF_NOTIFIED = 'Someone from the team has been notified and will pick this up.';
export const HANDOFF_PARTIAL = 'Your request was sent.';
export const HANDOFF_COPY: Record<HandoffError, string> = {
  invalid_email: "That email doesn't look right.",
  rejected: "We couldn't send your note. Try rewording it, or clear it and ask again.",
  already_asked: "You've already asked. The team has been notified.",
  unreachable: "Couldn't reach the team just now. Try again in a minute.",
  unavailable: "Chat isn't available right now.",
};

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
  /** Bar-level refusal (quota on a first turn, no agent, bad key, …). In
   *  memory only: a fixed misconfiguration unlocks on the next page load. */
  unavailable = $state<ChatFailure | null>(null);
  /** The browser's view of the network, kept by window online/offline events. */
  online = $state(true);
  /** Epoch ms until which Send and Retry are refused after a 429. */
  cooldownUntil = $state<number | null>(null);
  /** The visitor asked for a person and nobody has taken over yet (C11). */
  handoff = $state<'none' | 'pending'>('none');
  /** #hydrate is fetching the server's copy of a thread with nothing cached. */
  hydrating = $state(false);
  #rejected = $state(false);
  #botPaused = $state(false);

  /** The owner has taken over — the bot is muted for this visitor. Server
   *  state, mirrored here by the operator poll and by the human_replying
   *  frame; the panel shows a quiet chip while it's true. Turning true also
   *  ends a pending handoff: a person has picked the conversation up. */
  get botPaused(): boolean {
    return this.#botPaused;
  }
  set botPaused(value: boolean) {
    this.#botPaused = value;
    if (value) this.#setHandoff('none');
  }

  /** Offline with the queue full: the sixth send is refused, input kept. */
  queueFull = $derived(
    !this.online && this.messages.filter((m) => m.status === 'queued').length >= OFFLINE_QUEUE_CAP,
  );

  /** The single near-input line, highest priority first. The cooldown text is
   *  the seconds left when it was derived; a UI ticking a countdown recomputes
   *  from cooldownUntil. */
  notice = $derived.by((): Notice | null => {
    const u = this.unavailable;
    if (u) {
      const text = FAILURE_COPY.unavailable.line ?? '';
      return u.contactable
        ? { kind: 'unavailable', text: `${text} ${CONTACT_OFFER}`, action: 'contact' }
        : { kind: 'unavailable', text };
    }
    if (this.#rejected) return { kind: 'rejected', text: FAILURE_COPY.rejected.line ?? '' };
    if (!this.online && this.messages.some((m) => m.status === 'queued')) {
      return { kind: 'offline', text: this.queueFull ? OFFLINE_QUEUE_FULL : (FAILURE_COPY.offline.line ?? '') };
    }
    if (this.cooldownUntil !== null) {
      const left = (this.cooldownUntil - Date.now()) / 1000;
      return { kind: 'cooldown', text: formatCopy(FAILURE_COPY.rate_limited.line ?? '', left) };
    }
    if (this.#botPaused) return { kind: 'takeover', text: TAKEOVER_NOTICE };
    if (this.handoff === 'pending') return { kind: 'waiting', text: WAITING_NOTICE };
    return null;
  });

  /** Which of this visitor's conversations the panel is showing (2026-08-19).
   *  "" until the server names one, which is a legitimate state: a turn sent
   *  without an id lands on the conversation in progress, so the visitor can
   *  talk before the list has loaded. */
  conversationId = $state('');

  #config: ChatStoreConfig;
  #customerRef: string | null = null;
  #controller: AbortController | null = null;
  #flushing = false;
  #cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  #cooldownMs = 0;
  #cooldownEndedAt = 0;
  #onOnline = () => {
    this.online = true;
    void this.flushQueue();
  };
  #onOffline = () => {
    this.online = false;
  };

  constructor(config: ChatStoreConfig) {
    this.#config = config;
    // Continuity across iframe reloads (every host-page navigation reloads the
    // frame): rehydrate the visitor's persisted thread — the Intercom/Crisp
    // pattern. Statuses come back terminal; nothing resumes streaming.
    this.conversationId = loadActiveConversationId(config.widgetId);
    // The CACHE, painted first so the panel is never blank for a frame.
    this.messages = loadTranscript(config.widgetId, this.conversationId);
    this.handoff = loadHandoff(config.widgetId, this.conversationId) ? 'pending' : 'none';
    // Offline detection lives here, not in a component: the iframe gets its own
    // events, and the queue must flush whether or not the bar is open.
    this.online = browserOnline();
    try {
      window.addEventListener('online', this.#onOnline);
      window.addEventListener('offline', this.#onOffline);
    } catch {
      /* no window — the store still works, it just never hears about the network */
    }
    // Then the record. See #hydrate. Queued turns from a previous page flush
    // only after it settles: #hydrate stands down while anything streams.
    void this.#hydrate().finally(() => {
      if (this.online) void this.flushQueue();
    });
  }

  /** Drop the window listeners and the cooldown timer. */
  dispose(): void {
    try {
      window.removeEventListener('online', this.#onOnline);
      window.removeEventListener('offline', this.#onOffline);
    } catch {
      /* ignore */
    }
    if (this.#cooldownTimer) clearTimeout(this.#cooldownTimer);
    this.#cooldownTimer = null;
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
    // The "restoring" line is for a panel with nothing on it; a painted cache
    // needs no placeholder.
    this.hydrating = this.messages.length === 0;
    try {
      await this.#adoptServerTurns(conversationId);
    } finally {
      if (this.conversationId === conversationId) this.hydrating = false;
    }
  }

  async #adoptServerTurns(conversationId: string): Promise<void> {
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
    // Queued turns never reached the server, so its copy cannot hold them.
    const queued = this.messages.filter((m) => m.status === 'queued');
    this.messages = [
      ...turns.map((turn: WireTurn) => ({
        id: newId(),
        role: turn.role,
        content: turn.content,
        status: 'done' as const,
        ...(turn.at ? { at: turn.at } : {}),
      })),
      ...queued,
    ];
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
    this.#rejected = false;
    this.conversationId = conversationId;
    this.handoff = loadHandoff(this.#config.widgetId, conversationId) ? 'pending' : 'none';
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

  /** Send a visitor turn. Refused without touching the thread (the text handed
   *  back as restoreDraft) while a reply streams, during a cooldown, while the
   *  bar is unavailable, or with the offline queue full. Offline, the turn is
   *  queued rather than sent. */
  async send(text: string): Promise<SendResult> {
    const message = text.trim();
    if (!message) return { ok: false, kind: 'busy' };
    if (this.isStreaming) return { ok: false, kind: 'busy', restoreDraft: text };
    if (this.unavailable) return { ok: false, kind: 'unavailable', restoreDraft: text };
    if (this.#inCooldown()) return { ok: false, kind: 'rate_limited', restoreDraft: text };

    this.#rejected = false;
    if (!browserOnline()) {
      this.online = false;
      if (this.messages.filter((m) => m.status === 'queued').length >= OFFLINE_QUEUE_CAP) {
        return { ok: false, kind: 'offline', restoreDraft: text };
      }
      // No assistant bubble and no fetch: it goes when the network comes back.
      this.messages.push({ id: newId(), role: 'user', content: message, status: 'queued' });
      this.#persist();
      return { ok: true };
    }
    const userId = newId();
    this.messages.push({ id: userId, role: 'user', content: message, status: 'done' });
    return this.#stream(userId);
  }

  /** Re-send a failed turn. `messageId` is the latest failed turn: a user turn
   *  that was never answered, or an assistant reply that broke. The user bubble
   *  is reused (never duplicated) and a broken reply is replaced by a fresh
   *  one. A no-op while streaming, in cooldown, while unavailable, or for any
   *  failure older than the latest (re-asking out of order scrambles the
   *  thread). */
  async retry(messageId: string): Promise<SendResult> {
    if (this.unavailable) return { ok: false, kind: 'unavailable' };
    if (this.#inCooldown()) return { ok: false, kind: 'rate_limited' };
    if (this.isStreaming) return { ok: false, kind: 'busy' };
    let latest = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].status === 'error') {
        latest = i;
        break;
      }
    }
    if (latest < 0 || this.messages[latest].id !== messageId) return { ok: false, kind: 'busy' };

    let userIndex = latest;
    if (this.messages[latest].role !== 'user') {
      userIndex = -1;
      for (let i = latest - 1; i >= 0; i--) {
        if (this.messages[i].role === 'user') {
          userIndex = i;
          break;
        }
      }
      if (userIndex < 0) return { ok: false, kind: 'busy' };
      this.messages.splice(latest, 1);
    }
    this.#rejected = false;
    const user = this.messages[userIndex];
    if (!browserOnline()) {
      this.online = false;
      user.status = 'queued';
      user.failure = undefined;
      this.#persist();
      return { ok: true };
    }
    return this.#stream(user.id);
  }

  /** Send queued turns in order, one at a time, through the normal path. Stops
   *  at the first turn that fails (it takes that failure's kind). Runs on the
   *  window `online` event and on load. */
  async flushQueue(): Promise<void> {
    if (this.#flushing || !browserOnline()) return;
    this.#flushing = true;
    try {
      for (;;) {
        if (this.isStreaming || this.unavailable || this.#inCooldown()) return;
        const next = this.messages.find((m) => m.role === 'user' && m.status === 'queued');
        if (!next) return;
        const result = await this.#stream(next.id);
        if (!result.ok) return;
      }
    } finally {
      this.#flushing = false;
    }
  }

  /** The visitor edited the draft: the "try rewording it" line has done its job. */
  clearRejected(): void {
    this.#rejected = false;
  }

  /** Ask for a person (C11). `message` may be empty; `contact` is an email or "". */
  async requestHuman(note: { message: string; contact: string }): Promise<HandoffResult> {
    const res = await postRequestHuman(await this.#clientConfig(), {
      message: note.message.trim(),
      contact: note.contact.trim(),
    });
    if (res.ok) {
      const waiting = res.state === 'needs_human';
      if (waiting) this.#setHandoff('pending');
      // Only claim the conversation was queued when the server says it was.
      this.#appendSystem(waiting ? res.message || HANDOFF_NOTIFIED : HANDOFF_PARTIAL);
      this.#persist();
      return { ok: true, waiting };
    }
    const fail = (error: HandoffError): HandoffResult => ({ ok: false, error, text: HANDOFF_COPY[error] });
    if (res.status === 422 && res.detail === 'invalid_email') return fail('invalid_email');
    if (res.status === 400 && res.detail === 'message_rejected') return fail('rejected');
    // Not chat's 429: this one means "you already asked", so no cooldown.
    if (res.status === 429 && res.detail === 'handoff_rate_limit') {
      this.#setHandoff('pending');
      return fail('already_asked');
    }
    if ([401, 403, 404, 409].includes(res.status)) {
      // The front gate chat shares refused it: nothing here can get through.
      const failure: ChatFailure = {
        kind: 'unavailable',
        scope: 'bar',
        on: 'none',
        contactable: false,
        ownerReason: `request-human HTTP ${res.status} ${res.detail ?? '(no detail)'}`,
      };
      reportFailure(failure);
      this.unavailable = failure;
      return fail('unavailable');
    }
    return fail('unreachable');
  }

  /** Stream a reply to an existing user turn: the send, retry and flush path.
   *  The fresh assistant bubble goes right after its user turn. */
  async #stream(userId: string): Promise<SendResult> {
    const user = this.messages.find((m) => m.id === userId);
    if (!user) return { ok: false, kind: 'busy' };
    const message = user.content;
    user.status = 'done';
    user.failure = undefined;
    // Track the assistant turn by id, never by a captured object reference:
    // $state wraps pushed objects in proxies with a distinct identity, so a
    // captured plain ref both fails === checks AND bypasses reactivity. We
    // always mutate through the reactive array via #assistant(id).
    const assistantId = newId();
    const at = this.messages.findIndex((m) => m.id === userId);
    this.messages.splice(at + 1, 0, { id: assistantId, role: 'assistant', content: '', status: 'streaming' });
    this.isStreaming = true;
    // Persist the user turn immediately — a navigation mid-stream keeps the
    // question even when the answer is lost.
    this.#persist();

    const controller = new AbortController();
    this.#controller = controller;
    // Set by the human_replying frame: this turn legitimately produces no
    // assistant text because a person is answering instead.
    let humanReplying = false;
    let result: SendResult = { ok: true };

    const clientConfig = await this.#clientConfig();

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
          // Keep whatever streamed (a stop() with text is marked `stopped`). If
          // nothing streamed: a user stop() and a paused bot both drop the empty
          // bubble silently; a clean end with no text and no takeover is the
          // `empty` failure (it used to be the raw 'No reply.' string).
          const m = this.#assistant(assistantId);
          if (m) {
            if (m.content) {
              m.status = 'done';
              if (info.cancelled) m.stopped = true;
            } else if (info.cancelled || humanReplying) {
              this.messages = this.messages.filter((x) => x.id !== assistantId);
            } else if (this.#controller === controller) {
              result = this.#fail(userId, assistantId, { source: 'empty' });
            }
          }
          this.#finish(controller);
          this.#persist();
        },
        onError: (raw) => {
          // A superseded stream (reset / switch) must not lock the bar or start
          // a cooldown for the thread that replaced it.
          if (this.#controller === controller) result = this.#fail(userId, assistantId, raw);
          this.#finish(controller);
          this.#persist();
        },
      },
      controller.signal,
    );
    return result;
  }

  /** Classify a failure and put it where it shows: on the assistant turn, on
   *  the user turn, on the bar, or (rejected) back in the draft. */
  #fail(userId: string, assistantId: string, raw: RawFailure): SendResult {
    const firstUser = this.messages.find((m) => m.role === 'user');
    const failure = classifyError(raw, { firstUserTurn: firstUser?.id === userId });
    reportFailure(failure);

    if (failure.on === 'assistant') {
      const m = this.#assistant(assistantId);
      if (m) {
        m.status = 'error';
        m.failure = failure.kind;
      }
      return { ok: false, kind: failure.kind };
    }
    // Refused before any reply started: the empty assistant bubble goes.
    this.messages = this.messages.filter((m) => m.id !== assistantId);
    const user = this.messages.find((m) => m.id === userId);
    if (failure.kind === 'rejected') {
      this.messages = this.messages.filter((m) => m.id !== userId);
      this.#rejected = true;
      return { ok: false, kind: 'rejected', restoreDraft: user?.content };
    }
    if (user) {
      user.status = failure.kind === 'offline' ? 'queued' : 'error';
      user.failure = failure.kind === 'offline' ? undefined : failure.kind;
    }
    if (failure.kind === 'offline') this.online = false;
    if (failure.kind === 'rate_limited') this.#startCooldown(failure.retryAfterMs);
    if (failure.kind === 'unavailable') this.unavailable = failure;
    return { ok: false, kind: failure.kind };
  }

  #inCooldown(): boolean {
    return this.cooldownUntil !== null && this.cooldownUntil > Date.now();
  }

  /** A 429 within 60s of the previous cooldown ending doubles it (max 60s). */
  #startCooldown(ms = DEFAULT_COOLDOWN_MS): void {
    const now = Date.now();
    let length = ms;
    if (this.#cooldownEndedAt && now - this.#cooldownEndedAt < 60_000) {
      length = Math.min(MAX_COOLDOWN_MS, Math.max(ms, this.#cooldownMs * 2));
    }
    this.#cooldownMs = length;
    this.cooldownUntil = now + length;
    if (this.#cooldownTimer) clearTimeout(this.#cooldownTimer);
    this.#cooldownTimer = setTimeout(() => {
      // No auto-resend at zero: the visitor may have moved on; Retry is one tap.
      this.cooldownUntil = null;
      this.#cooldownEndedAt = Date.now();
      this.#cooldownTimer = null;
    }, length);
  }

  #setHandoff(value: 'none' | 'pending'): void {
    if (this.handoff === value) return;
    this.handoff = value;
    saveHandoff(this.#config.widgetId, this.conversationId, value === 'pending');
  }

  async #clientConfig(): Promise<ConciergeChatConfig> {
    return {
      endpoint: this.#config.endpoint,
      widgetId: this.#config.widgetId,
      signedKey: this.#config.siteKey,
      customerRef: await this.#resolveCustomerRef(),
      conversationId: this.conversationId,
    };
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
      if (incoming.role === 'owner') {
        this.#ensureJoinNotice(incoming.at);
        // A person has written: the visitor is no longer waiting for one.
        this.#setHandoff('none');
      }
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
    this.#rejected = false;
    this.isStreaming = false;
    // The pending ask belonged to the conversation just retired.
    this.#setHandoff('none');
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

/** Only onLine === false proves offline; anything else is treated as online. */
function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
