// customer-ref.ts — Cookie-free customer_ref: a SHA-256 hash of a random
// client-side value. Matches the privacy posture from PAW-BAR-MVP.md: no email,
// no IP, just a stable anonymous handle so rate limiting + session stitching
// work on the server without storing PII. Falls back to a memory-only ref when
// localStorage is blocked (Safari private mode, embedded in iframes).
// Ported VERBATIM 2026-07-15 (A3 glass bar) from the frozen widget's
//   feat/paw-bar-chat-ui:src/customer-ref.ts (T4) — no behavior change.
//
// 2026-08-19 (conversation identity): the key is now NAMESPACED PER WIDGET.
// It wasn't, and the transcript key sitting right beside it always was
// (`pawbar.transcript.v1.<widgetId>` — see lib/transcript.ts). That asymmetry
// was a real leak rather than an inconsistency: this storage lives in the
// FRAME's origin, which is the backend's, and that origin is SHARED by every
// site the backend serves. So one browser handed the SAME anonymous handle to
// every tenant's bar, and two unrelated site owners could see one visitor
// under one id. Namespacing closes it — a visitor is now anonymous per site,
// which is what "anonymous" was supposed to mean.
//
// The legacy unnamespaced value is MIGRATED rather than dropped: a visitor
// mid-conversation when this ships keeps their thread (the server keys
// conversations on this handle), and the old row is left in place because a
// sibling widget in another tab may still be reading it. It ages out on its
// own once every widget has migrated.

const LEGACY_STORAGE_KEY = 'pawbar.customer_ref';
const KEY_PREFIX = 'pawbar.customer_ref.v2.';

// One in-flight PROMISE per widget, not one resolved value.
//
// The distinction is the whole point. Four stores (chat, cart, contact,
// operator) ask for the handle as the panel opens, and minting one is async —
// so with a value cache all four miss it before the first await resolves, all
// four mint a DIFFERENT random handle, and the last one to finish wins the
// storage write. Observed live: one page load produced three distinct refs, so
// the operator poll was asking about a visitor the chat had never been and the
// owner's replies could never have arrived. Caching the promise means the first
// caller does the work and the rest await the same answer.
const inflight = new Map<string, Promise<string>>();

function key(widgetId: string): string {
  return `${KEY_PREFIX}${widgetId}`;
}

// widgetId is REQUIRED, not defaulted. It was briefly optional while this was
// being namespaced, and three of the five call sites (cart, contact, operator)
// silently kept calling it bare — which resolved them to a DIFFERENT visitor
// than the chat store, so the owner's replies would have polled against a
// handle the conversation never used. A required parameter turns that into a
// compile error instead of a support ticket.
export function getCustomerRef(widgetId: string): Promise<string> {
  const pending = inflight.get(widgetId);
  if (pending) return pending;
  const promise = resolveCustomerRef(widgetId);
  inflight.set(widgetId, promise);
  return promise;
}

async function resolveCustomerRef(widgetId: string): Promise<string> {
  const storageKey = key(widgetId);
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) return stored;
  } catch {
    // localStorage blocked — fall through to migrate-or-mint below.
  }

  // Migrate the pre-namespace handle so an in-flight conversation survives the
  // upgrade. Only the FIRST widget to look wins it; every other widget on the
  // frame origin mints its own, which is the point of the change.
  const migrated = claimLegacyRef(storageKey);
  if (migrated) return migrated;

  const seed = await mintSeed();
  const hashed = await sha256Hex(seed);
  try {
    window.localStorage.setItem(storageKey, hashed);
  } catch {
    // Best-effort persistence; the ref still works for the session.
  }
  return hashed;
}

/** Move the legacy unnamespaced ref under this widget's key, once.
 *
 *  Guarded by a marker rather than by deleting the legacy row: another widget
 *  in another tab may be mid-request against it, and a delete would strand
 *  that conversation. The marker means exactly one widget adopts the old
 *  handle, so two sites can't end up sharing it through the migration itself.
 */
function claimLegacyRef(storageKey: string): string | null {
  const CLAIMED = 'pawbar.customer_ref.claimed';
  try {
    if (window.localStorage.getItem(CLAIMED)) return null;
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return null;
    window.localStorage.setItem(storageKey, legacy);
    window.localStorage.setItem(CLAIMED, '1');
    return legacy;
  } catch {
    return null;
  }
}

async function mintSeed(): Promise<string> {
  const bytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  if (window.crypto?.subtle) {
    const buf = new TextEncoder().encode(input);
    const hashed = await window.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashed), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // No WebCrypto — fall back to a deterministic FNV-1a 32-bit hash repeated
  // out to 64 hex chars. Good enough for a non-cryptographic anonymous ref.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const base = (h >>> 0).toString(16).padStart(8, '0');
  return base.repeat(8);
}
