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

import type { Message, MessageRole } from '../store/chat.svelte';
import { sanitizeSources } from './sources';

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
const KEY_PREFIX = 'pawbar.transcript.v2.';
const LEGACY_KEY_PREFIX = 'pawbar.transcript.v1.';
const ACTIVE_PREFIX = 'pawbar.active.v1.';
export const TRANSCRIPT_CAP = 60;
export const TRANSCRIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface StoredTranscript {
  saved_at: number;
  messages: Array<Pick<Message, 'id' | 'role' | 'content' | 'status' | 'sources' | 'at'>>;
}

const ROLES: readonly MessageRole[] = ['user', 'assistant', 'owner', 'system'];

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
      out.push({
        id: typeof m.id === 'string' && m.id ? m.id : `m-restored-${out.length}`,
        role,
        content,
        // Never rehydrate 'streaming' — nothing is streaming after a reload.
        status: m.status === 'error' ? 'error' : 'done',
        ...(sources.length > 0 ? { sources } : {}),
        ...(at ? { at } : {}),
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

export function clearTranscript(widgetId: string, conversationId = ''): void {
  try {
    window.localStorage.removeItem(key(widgetId, conversationId));
  } catch {
    // ignore
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
