// transcript.ts — localStorage persistence for the visitor's conversation.
// Created 2026-07-30 (UX gap: reopening the bar showed an EMPTY transcript).
// The iframe reloads on every host-page navigation, so without persistence a
// visitor lost the whole conversation walking from the home page to the menu —
// the exact continuity Intercom/Crisp/Chatbase widgets provide by persisting
// the thread against the anonymous visitor token. Same posture here:
//
//   * Storage lives in the FRAME's localStorage (the backend origin), beside
//     pawbar.customer_ref — the visitor's own device, so restore works even
//     when the site owner has server-side transcript retention switched OFF.
//   * The frame origin is SHARED by every site the backend serves, so the key
//     is namespaced per widget: pawbar.transcript.v1.<widgetId>. One site's
//     thread can never bleed into a sibling site's bar.
//   * Capped (last TRANSCRIPT_CAP turns) + TTL'd (TRANSCRIPT_TTL_MS): an
//     abandoned thread from weeks ago greets nobody. Expiry deletes the row.
//   * Never throws: localStorage blocked (Safari private mode etc.) degrades
//     to session-only chat — identical to the customer-ref fallback.
//   * Loaded turns are coerced to terminal statuses ('done' / 'error'); a
//     'streaming' status must never be rehydrated (nothing is streaming).
//
// 2026-07-30 (quick actions): serializeTranscript — the pure text export the
// panel's "Download transcript" action feeds into a Blob download. Lives here
// (not in the component) so it tests without DOM.
// 2026-07-30 (sources on replies): rows persist an assistant turn's optional
// source citations (titles + urls of PUBLIC pages — safe to store) and load
// re-sanitizes them through lib/sources, so a tampered row can't smuggle a
// non-http(s) href back into the DOM.
// 2026-07-30 (human takeover): owner + system turns persist and restore on the
// SAME terms as assistant turns — same cap, same TTL, same status coercion
// (nothing rehydrates as 'streaming'). Their server timestamp (`at`) rides
// along so the operator poll can resume from its high-water mark after a
// reload instead of re-appending messages the visitor already has. Roles
// outside the allowlist are dropped, so an edited row can't invent a speaker.
// 2026-09-27 (paw-bar states, sections C5/D/C11): rows keep three new things.
// `status: 'queued'` — an offline send the server has never seen; coercing it to
// 'done' on reload would show an unsent message as sent. `failure` — the
// FailureKind of a failed turn, so its note survives a reload. `stopped` — a
// reply the visitor stopped with partial text. `unavailable` — why the server
// could not answer an assistant turn ('temporary' | 'limit'), for its note. Plus a per-conversation handoff
// flag (loadHandoff / saveHandoff) so "Waiting for the team" survives a reload.
// A row that predates these simply reads as it did before.
// An assistant turn's page `action` ({do, to?, target?, label, state}) persists
// too, so "Taking you to …" survives the navigation it causes and can become
// "Here's the page". Loading re-sanitizes it (lib/page-actions) and settles a
// 'pending' state to 'done': nothing is in flight after a reload. A tool
// action keeps a terminal state and result `message`, but never comes back
// actionable or as a claim it ran: 'confirm' (never answered) restores as
// 'expired' ("Not done", no buttons), and 'pending' (stored BEFORE it is
// posted, so possibly failed or unfinished) as 'sent'. Neither runs again.
// A tool action is restored by shape (the registry arrives after boot).

import type { Message, MessageRole } from '../store/chat.svelte';
import type { FailureKind } from './chat-errors';
import { sanitizeSources } from './sources';
import { resultMessage, sanitizeAction, type PageActionState } from './page-actions';

// 2026-08-19 (conversation identity): the row is keyed per CONVERSATION, not
// per widget. A visitor may now hold several, and the Messages tab lets them
// walk back into an old one — which needs that conversation's own turns, not
// whatever the widget last had. Reading a past conversation from the SERVER is
// deliberately not the answer: the site owner can switch transcript retention
// off entirely, and this store is the visitor's own device, so it keeps working
// exactly where a server read would (correctly) have nothing to return.
//
// ACTIVE_KEY remembers which conversation to resume on reload, since the iframe
// reloads on every host-page navigation and the server's answer arrives later
// than the first paint.
// 2026-08-21 (resume the thread): migrateActiveTranscript — the row a visitor
// builds BEFORE the server names their conversation is filed under the ".active"
// sentinel, and adoption now carries it across to the real id. It did not, which
// is how a visitor with a conversation on disk opened the bar to an empty panel.
//
const KEY_PREFIX = 'pawbar.transcript.v2.';
const LEGACY_KEY_PREFIX = 'pawbar.transcript.v1.';
const ACTIVE_PREFIX = 'pawbar.active.v1.';
const HANDOFF_PREFIX = 'pawbar.handoff.v1.';
const FAILURES: readonly FailureKind[] = [
  'offline', 'unreachable', 'rate_limited', 'rejected', 'unavailable', 'interrupted', 'server', 'empty',
];
export const TRANSCRIPT_CAP = 60;
export const TRANSCRIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface StoredTranscript {
  saved_at: number;
  messages: Array<Pick<Message, 'id' | 'role' | 'content' | 'status' | 'sources' | 'at' | 'failure' | 'stopped' | 'action' | 'unavailable'>>;
}

const ROLES: readonly MessageRole[] = ['user', 'assistant', 'owner', 'system'];
const ACTION_STATES: readonly PageActionState[] = ['done', 'failed', 'arrived', 'fallback'];
const TOOL_STATES: readonly PageActionState[] = ['done', 'failed', 'cancelled', 'expired', 'sent'];
/** A stored tool state that is not terminal, settled for a reload. */
const TOOL_SETTLE: Partial<Record<PageActionState, PageActionState>> = { confirm: 'expired', pending: 'sent' };

function restoreAction(raw: unknown): Message['action'] | undefined {
  const action = sanitizeAction(raw);
  if (!action) return undefined;
  const { state, message: rawMessage } = raw as { state?: unknown; message?: unknown };
  const tool = action.do === 'tool';
  const stored = (tool ? TOOL_SETTLE[state as PageActionState] : undefined) ?? (state as PageActionState);
  const states = tool ? TOOL_STATES : ACTION_STATES;
  const message = tool ? resultMessage(rawMessage) : undefined;
  return {
    ...action,
    // An unknown tool state is neutral, never a claim that it ran.
    state: states.includes(stored) ? stored : tool ? 'sent' : 'done',
    ...(message ? { message } : {}),
  };
}

function key(widgetId: string, conversationId = ''): string {
  return `${KEY_PREFIX}${widgetId}.${conversationId || 'active'}`;
}

/** The conversation the visitor was last in, so a reload resumes it. */
export function loadActiveConversationId(widgetId: string): string {
  if (!widgetId) return '';
  try {
    return window.localStorage.getItem(`${ACTIVE_PREFIX}${widgetId}`) || '';
  } catch {
    return '';
  }
}

export function saveActiveConversationId(widgetId: string, conversationId: string): void {
  if (!widgetId) return;
  try {
    if (conversationId) {
      window.localStorage.setItem(`${ACTIVE_PREFIX}${widgetId}`, conversationId);
    } else {
      window.localStorage.removeItem(`${ACTIVE_PREFIX}${widgetId}`);
    }
  } catch {
    // Storage blocked — the session keeps its in-memory conversation.
  }
}

/** Adopt a pre-conversation transcript as the row for `conversationId`, once.
 *
 *  A visitor mid-thread when this ships would otherwise open the bar to an
 *  empty panel while the server still holds their conversation. The legacy row
 *  is REMOVED as it is adopted, so this can only happen for the first
 *  conversation and a later one never inherits a stranger's turns. */
export function migrateLegacyTranscript(widgetId: string, conversationId: string): void {
  if (!widgetId || !conversationId) return;
  try {
    const legacy = window.localStorage.getItem(`${LEGACY_KEY_PREFIX}${widgetId}`);
    if (!legacy) return;
    const target = key(widgetId, conversationId);
    if (!window.localStorage.getItem(target)) window.localStorage.setItem(target, legacy);
    window.localStorage.removeItem(`${LEGACY_KEY_PREFIX}${widgetId}`);
  } catch {
    // Nothing to migrate into — the visitor starts fresh, which is survivable.
  }
}

/** Carry the pre-identity row across to the conversation the server just named.

 *  A turn sent before the conversation list has loaded is persisted under
 *  key(widgetId, "") — the literal ".active" sentinel — because the store has no
 *  id to file it under yet. That is the COMMON path, not an edge case: the
 *  composer accepts a question the moment the panel opens, while the list is
 *  still in flight.
 *
 *  Without this, adoption took the id and left the turns behind. The pointer
 *  named one row and the transcript sat in another, so the next reload resumed a
 *  conversation with nothing filed under it and painted an empty panel while the
 *  thread was still on disk one key away. Repeat over a few visits and storage
 *  fills with orphaned rows under conversations the visitor can no longer reach.
 *
 *  Same once-only rule as the v1 migration: the sentinel is REMOVED as it is
 *  adopted, so a later conversation can never inherit an earlier one's turns.
 *  An existing row under the target is never clobbered — it is the newer of the
 *  two by construction. */
export function migrateActiveTranscript(widgetId: string, conversationId: string): void {
  if (!widgetId || !conversationId) return;
  try {
    const sentinel = key(widgetId, '');
    const row = window.localStorage.getItem(sentinel);
    if (!row) return;
    const target = key(widgetId, conversationId);
    if (!window.localStorage.getItem(target)) window.localStorage.setItem(target, row);
    window.localStorage.removeItem(sentinel);
  } catch {
    // Storage blocked — the in-memory thread is untouched, and the session
    // keeps the turns it is already showing.
  }
}

/** Restore the persisted thread for this widget, or [] (expired / absent /
 *  malformed / storage blocked). Malformed rows are deleted on sight. */
export function loadTranscript(widgetId: string, conversationId = ''): Message[] {
  if (!widgetId) return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key(widgetId, conversationId));
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredTranscript;
    if (
      !parsed ||
      typeof parsed.saved_at !== 'number' ||
      !Array.isArray(parsed.messages) ||
      Date.now() - parsed.saved_at > TRANSCRIPT_TTL_MS
    ) {
      clearTranscript(widgetId, conversationId);
      return [];
    }
    const out: Message[] = [];
    for (const m of parsed.messages) {
      if (!m || typeof m !== 'object') continue;
      const role = ROLES.includes(m.role) ? m.role : null;
      const content = typeof m.content === 'string' ? m.content : '';
      if (!role || !content) continue;
      // Re-sanitize stored citations — never trust a row someone edited.
      const sources = role === 'assistant' ? sanitizeSources(m.sources) : [];
      // The poll cursor only means anything for the human half of the thread.
      const at = (role === 'owner' || role === 'system') && typeof m.at === 'string' ? m.at : '';
      const action = role === 'assistant' ? restoreAction(m.action) : undefined;
      out.push({
        id: typeof m.id === 'string' && m.id ? m.id : `m-restored-${out.length}`,
        role,
        content,
        // Never rehydrate 'streaming' — nothing is streaming after a reload. A
        // queued turn stays queued: the server has never seen it.
        status: m.status === 'error' || (m.status === 'queued' && role === 'user') ? m.status : 'done',
        ...(sources.length > 0 ? { sources } : {}),
        ...(at ? { at } : {}),
        ...(m.status === 'error' && FAILURES.includes(m.failure as FailureKind) ? { failure: m.failure } : {}),
        ...(m.status === 'error' && (m.unavailable === 'temporary' || m.unavailable === 'limit')
          ? { unavailable: m.unavailable }
          : {}),
        ...(m.stopped === true ? { stopped: true } : {}),
        ...(action ? { action } : {}),
      });
    }
    return out.slice(-TRANSCRIPT_CAP);
  } catch {
    clearTranscript(widgetId, conversationId);
    return [];
  }
}

/** Persist the thread (terminal turns only, capped). Best-effort. */
export function saveTranscript(widgetId: string, messages: Message[], conversationId = ''): void {
  if (!widgetId) return;
  const terminal = messages
    .filter((m) => m.status !== 'streaming' && m.content)
    .slice(-TRANSCRIPT_CAP)
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      status: m.status,
      ...(m.sources && m.sources.length > 0
        ? { sources: m.sources.map((s) => ({ title: s.title, url: s.url })) }
        : {}),
      ...(m.at ? { at: m.at } : {}),
      ...(m.failure ? { failure: m.failure } : {}),
      ...(m.unavailable ? { unavailable: m.unavailable } : {}),
      ...(m.stopped ? { stopped: true } : {}),
      ...(m.action ? { action: { ...m.action, ...(m.action.args ? { args: { ...m.action.args } } : {}) } } : {}),
    }));
  try {
    if (terminal.length === 0) {
      window.localStorage.removeItem(key(widgetId, conversationId));
      return;
    }
    const row: StoredTranscript = { saved_at: Date.now(), messages: terminal };
    window.localStorage.setItem(key(widgetId, conversationId), JSON.stringify(row));
  } catch {
    // Storage blocked or quota — the session keeps its in-memory thread.
  }
}

/** When the stored thread was last written (epoch ms), or null when there is
 *  no readable row. Lets the store skip a server re-hydrate for a fresh cache. */
export function transcriptSavedAt(widgetId: string, conversationId = ''): number | null {
  if (!widgetId) return null;
  try {
    const raw = window.localStorage.getItem(key(widgetId, conversationId));
    const savedAt = raw ? (JSON.parse(raw) as StoredTranscript).saved_at : null;
    return typeof savedAt === 'number' ? savedAt : null;
  } catch {
    return null;
  }
}

export function clearTranscript(widgetId: string, conversationId = ''): void {
  try {
    window.localStorage.removeItem(key(widgetId, conversationId));
  } catch {
    // ignore
  }
}

/** Has this visitor asked for a person in this conversation (C11)? */
export function loadHandoff(widgetId: string, conversationId = ''): boolean {
  try {
    return window.localStorage.getItem(`${HANDOFF_PREFIX}${widgetId}.${conversationId || 'active'}`) === 'pending';
  } catch {
    return false;
  }
}

export function saveHandoff(widgetId: string, conversationId: string, pending: boolean): void {
  const k = `${HANDOFF_PREFIX}${widgetId}.${conversationId || 'active'}`;
  try {
    if (pending) window.localStorage.setItem(k, 'pending');
    else window.localStorage.removeItem(k);
  } catch {
    // Storage blocked — the flag lives for this page view only.
  }
}

/** Plain-text export of the thread for the visitor's own records. One header
 *  line naming the concierge + the date, then "Visitor: …" / "Concierge: …" /
 *  "Team: …" lines with a blank line after each reply; system notices export
 *  as a bare "— …" line, since nobody said them. Pure — no DOM, no storage —
 *  so the download action stays a thin Blob wrapper around it. */
export function serializeTranscript(messages: Message[], title = 'Concierge', date = new Date()): string {
  let out = `${title} conversation — ${date.toISOString().slice(0, 10)}\n\n`;
  for (const m of messages) {
    if (!m.content) continue;
    if (m.role === 'system') {
      out += `— ${m.content}\n\n`;
      continue;
    }
    const speaker = m.role === 'user' ? 'Visitor' : m.role === 'owner' ? 'Team' : 'Concierge';
    out += `${speaker}: ${m.content}\n`;
    if (m.role !== 'user') out += '\n';
  }
  return out;
}
