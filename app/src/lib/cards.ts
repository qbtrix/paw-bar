// cards.ts — Types + safe parse/format helpers for `pawbar-card` fence blocks.
// Created 2026-07-15 (C2 action loop). Cards are AGENT-AUTHORED JSON on a PUBLIC
// origin, so this module NEVER trusts a field for HTML: the app renders cards
// through Svelte text/attribute bindings only (the DOMPurify markdown path is
// untouched). parseCard validates + coerces the JSON and returns null on any
// shape violation — a malformed or stream-truncated card is routed to a quiet
// "card unavailable" fallback rather than throwing or leaking raw JSON into the
// bubble. isRenderable gates the card KIND: only kinds with a native renderer
// (RENDERABLE_KINDS) draw; an unknown kind (e.g. a future "booking") takes the
// same fallback instead of being mis-rendered as a product. Contract (frozen,
// C1/C2):
//   {"kind":"product","items":[{"id","name","price_cents","currency",
//    "image_url","actions":["add_to_cart"]}]}

export interface CardItem {
  id: string;
  name: string;
  price_cents?: number;
  currency?: string;
  image_url?: string;
  description?: string;
  /** Allowlisted verbs the card exposes as CTAs; validated server-side per widget. */
  actions: string[];
}

export interface PawBarCard {
  kind: string;
  items: CardItem[];
}

/** Validate + coerce an agent-authored card JSON string into a PawBarCard, or
 *  null if it's malformed / empty. Unknown fields are dropped; an item needs a
 *  name to render. Pure + DOM-free so it unit-tests without a browser. */
export function parseCard(json: string): PawBarCard | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const kind = typeof obj.kind === 'string' && obj.kind ? obj.kind : 'product';
  const rawItems = Array.isArray(obj.items) ? obj.items : [];

  const items: CardItem[] = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name) continue; // an item without a name has nothing to show
    items.push({
      id: typeof r.id === 'string' ? r.id : '',
      name,
      price_cents: typeof r.price_cents === 'number' && Number.isFinite(r.price_cents) ? r.price_cents : undefined,
      currency: typeof r.currency === 'string' ? r.currency : undefined,
      image_url: typeof r.image_url === 'string' ? r.image_url : undefined,
      description: typeof r.description === 'string' ? r.description : undefined,
      actions: Array.isArray(r.actions) ? r.actions.filter((a): a is string => typeof a === 'string') : [],
    });
  }
  if (items.length === 0) return null;
  return { kind, items };
}

// Card kinds that have a native renderer in v1. An agent-supplied kind outside
// this set renders the quiet fallback, never a mismatched card (a "booking"
// must not draw as a product with an "Add to cart" CTA).
export const RENDERABLE_KINDS = new Set(['product']);

/** True when a parsed card has a kind the app can actually render. Null (a
 *  malformed / truncated / itemless card) and unknown kinds both return false,
 *  so CardBlock draws the same "card unavailable" fallback for all of them. */
export function isRenderable(card: PawBarCard | null): boolean {
  return !!card && RENDERABLE_KINDS.has(card.kind);
}

const VERB_LABELS: Record<string, string> = {
  add_to_cart: 'Add to cart',
  checkout: 'Checkout',
  book_table: 'Book a table',
  contact: 'Contact',
  reserve: 'Reserve',
};

/** Human label for an action verb — declaration labels aren't carried in the
 *  card item, so we prettify the verb (title-case) when it isn't a known one. */
export function verbLabel(verb: string): string {
  return VERB_LABELS[verb] ?? verb.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format minor currency units to a display price; '' when there's no price. */
export function formatPrice(cents: number | undefined, currency = 'USD'): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return '';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Only http(s) or a RASTER data-image URL is safe as an untrusted <img src>.
 *  Anything else (javascript:, blob:, data:image/svg+xml, other schemes) → ''
 *  so the card shows a placeholder instead. <img> never executes script, but
 *  we stay conservative on a public origin. */
export function safeImageUrl(url: string | undefined): string {
  if (!url) return '';
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^data:image\/(png|jpe?g|gif|webp|avif);/i.test(u)) return u;
  return '';
}
