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

import type { Message } from '../store/chat.svelte';

const KEY_PREFIX = 'pawbar.transcript.v1.';
export const TRANSCRIPT_CAP = 60;
export const TRANSCRIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface StoredTranscript {
  saved_at: number;
  messages: Array<Pick<Message, 'id' | 'role' | 'content' | 'status'>>;
}

function key(widgetId: string): string {
  return `${KEY_PREFIX}${widgetId}`;
}

/** Restore the persisted thread for this widget, or [] (expired / absent /
 *  malformed / storage blocked). Malformed rows are deleted on sight. */
export function loadTranscript(widgetId: string): Message[] {
  if (!widgetId) return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key(widgetId));
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
      clearTranscript(widgetId);
      return [];
    }
    const out: Message[] = [];
    for (const m of parsed.messages) {
      if (!m || typeof m !== 'object') continue;
      const role = m.role === 'user' || m.role === 'assistant' ? m.role : null;
      const content = typeof m.content === 'string' ? m.content : '';
      if (!role || !content) continue;
      out.push({
        id: typeof m.id === 'string' && m.id ? m.id : `m-restored-${out.length}`,
        role,
        content,
        // Never rehydrate 'streaming' — nothing is streaming after a reload.
        status: m.status === 'error' ? 'error' : 'done',
      });
    }
    return out.slice(-TRANSCRIPT_CAP);
  } catch {
    clearTranscript(widgetId);
    return [];
  }
}

/** Persist the thread (terminal turns only, capped). Best-effort. */
export function saveTranscript(widgetId: string, messages: Message[]): void {
  if (!widgetId) return;
  const terminal = messages
    .filter((m) => m.status !== 'streaming' && m.content)
    .slice(-TRANSCRIPT_CAP)
    .map((m) => ({ id: m.id, role: m.role, content: m.content, status: m.status }));
  try {
    if (terminal.length === 0) {
      window.localStorage.removeItem(key(widgetId));
      return;
    }
    const row: StoredTranscript = { saved_at: Date.now(), messages: terminal };
    window.localStorage.setItem(key(widgetId), JSON.stringify(row));
  } catch {
    // Storage blocked or quota — the session keeps its in-memory thread.
  }
}

export function clearTranscript(widgetId: string): void {
  try {
    window.localStorage.removeItem(key(widgetId));
  } catch {
    // ignore
  }
}
