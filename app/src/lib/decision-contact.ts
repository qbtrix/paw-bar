// decision-contact.ts — Transport + storage flag for the "email me when the
// team confirms" moment. Created 2026-07-30 (email capture on pending
// decisions). Sibling of action-client: one fetch each, credentials omitted,
// CORS mode, no retry, and every failure degrades SILENTLY — this runs on a
// public widget, so a missing endpoint / old backend / network blip must never
// surface an error wall or block chat. Contracts (exact):
//   GET  {endpoint}/paw-bar/events/{widget_id}/decision/{customer_ref}?signed_key=…
//        → {found, state: pending|delivered|declined, reply, decided_by, updated_at}
//   POST {endpoint}/paw-bar/decision-contact
//        {widget_id, signed_key, customer_ref, email} → 200 {ok:true, attached:N}
//        refusals 404/429/401/403/400, and 422 invalid_email.
// The "already left contact" flag lives in the frame's localStorage
// (pawbar.contact.v1.<widgetId> — same conventions as lib/transcript: per
// widget, never throws, value is a bare marker, NEVER the email itself).

import type { ConciergeChatConfig } from './chat-client';

const FLAG_PREFIX = 'pawbar.contact.v1.';

export interface DecisionStatus {
  found: boolean;
  state: string;
}

function base(endpoint: string): string {
  return endpoint.replace(/\/$/, '');
}

/** One poll of the visitor's decision status. Any failure (HTTP refusal,
 *  network error, endpoint absent on an old backend, malformed body) → null. */
export async function getDecisionStatus(
  config: ConciergeChatConfig,
  signal?: AbortSignal,
): Promise<DecisionStatus | null> {
  const url =
    `${base(config.endpoint)}/paw-bar/events/${encodeURIComponent(config.widgetId)}` +
    `/decision/${encodeURIComponent(config.customerRef)}` +
    `?signed_key=${encodeURIComponent(config.signedKey)}`;
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', credentials: 'omit', mode: 'cors', cache: 'no-store', signal });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as { found?: unknown; state?: unknown };
    if (!data || typeof data !== 'object' || typeof data.found !== 'boolean') return null;
    return { found: data.found, state: typeof data.state === 'string' ? data.state : '' };
  } catch {
    return null;
  }
}

export type ContactSubmitResult = 'ok' | 'invalid_email' | 'failed';

/** Attach the visitor's email to their pending decision. 422 maps to
 *  'invalid_email' (inline correction); every other refusal → 'failed'
 *  (the caller dismisses quietly). The email goes to this request body and
 *  NOWHERE else — no storage, no logs, no transcript. */
export async function postDecisionContact(
  config: ConciergeChatConfig,
  email: string,
  signal?: AbortSignal,
): Promise<ContactSubmitResult> {
  let res: Response;
  try {
    res = await fetch(`${base(config.endpoint)}/paw-bar/decision-contact`, {
      method: 'POST',
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        widget_id: config.widgetId,
        signed_key: config.signedKey,
        customer_ref: config.customerRef,
        email,
      }),
    });
  } catch {
    return 'failed';
  }
  if (res.status === 422) return 'invalid_email';
  if (!res.ok) return 'failed';
  try {
    const data = (await res.json()) as { ok?: unknown };
    return data && data.ok === true ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Has this visitor already left contact for this widget? */
export function hasContactFlag(widgetId: string): boolean {
  try {
    return window.localStorage.getItem(`${FLAG_PREFIX}${widgetId}`) !== null;
  } catch {
    // Storage blocked — treat as flagged so we never nag every page load
    // without being able to remember the answer.
    return true;
  }
}

export function setContactFlag(widgetId: string): void {
  try {
    window.localStorage.setItem(`${FLAG_PREFIX}${widgetId}`, String(Date.now()));
  } catch {
    // Best-effort; the session flag in the store still suppresses re-prompts.
  }
}
