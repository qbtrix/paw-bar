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
// 2026-07-30 (form cards): + kind "form" — the agent collects gated-action
// details through a structured form instead of prose. Contract (frozen, mirrors
// the concierge preamble):
//   {"kind":"form","verb":"book_visit","title"?, "submit_label"?,
//    "fields":[{"name","label","type": text|tel|email|number|textarea}]}
// verb + every field name must match the widget's declared action args
// (server-validated at execution time); fields are capped at MAX_FORM_FIELDS,
// and any shape violation routes to the same quiet fallback.

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

export const FORM_FIELD_TYPES = ['text', 'tel', 'email', 'number', 'textarea'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** One input in a kind:"form" card. `name` must be a declared arg of the
 *  card's verb (the server rejects unknown args at execution time). */
export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
}

/** Hard cap on form inputs — an agent-authored card past this is malformed. */
export const MAX_FORM_FIELDS = 8;

export interface PawBarCard {
  kind: string;
  items: CardItem[];
  /** kind:"form" only — the declared action verb the form submits. */
  verb?: string;
  title?: string;
  submit_label?: string;
  fields?: FormField[];
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
  if (kind === 'form') return parseFormCard(obj);
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
      // Deduped: ProductCard keys its CTA row on the verb, and a keyed each
      // block with a repeated key is a render-time throw. A card is
      // agent-authored JSON, so "the model listed add_to_cart twice" is a
      // payload we have to survive, not one we get to assume away.
      actions: Array.isArray(r.actions)
        ? [...new Set(r.actions.filter((a): a is string => typeof a === 'string'))]
        : [],
    });
  }
  if (items.length === 0) return null;
  return { kind, items };
}

/** Strict validation for a kind:"form" card. Every shape violation (missing
 *  verb, bad/empty fields, a field with a non-allowlisted type) returns null so
 *  the block draws the quiet fallback — never a half-broken form. Fields past
 *  MAX_FORM_FIELDS are dropped rather than failing the whole card. */
function parseFormCard(obj: Record<string, unknown>): PawBarCard | null {
  const verb = typeof obj.verb === 'string' ? obj.verb.trim() : '';
  if (!verb) return null;
  if (!Array.isArray(obj.fields)) return null;

  const fields: FormField[] = [];
  for (const entry of obj.fields) {
    if (!entry || typeof entry !== 'object') return null;
    const r = entry as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    const type = typeof r.type === 'string' ? r.type : '';
    if (!name || !label) return null;
    if (!(FORM_FIELD_TYPES as readonly string[]).includes(type)) return null;
    // A repeated field name is REFUSED, not deduped. FormCard renders these in
    // a keyed each block, and the submitted body is keyed on the name too — so
    // two fields sharing one means one of the visitor's answers silently
    // overwrites the other. There is no reading of that card safe to render.
    if (fields.some((f) => f.name === name)) return null;
    fields.push({ name, label, type: type as FormFieldType });
  }
  if (fields.length === 0) return null;
  return {
    kind: 'form',
    items: [],
    verb,
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : undefined,
    submit_label:
      typeof obj.submit_label === 'string' && obj.submit_label.trim()
        ? obj.submit_label.trim()
        : undefined,
    fields: fields.slice(0, MAX_FORM_FIELDS),
  };
}

// Card kinds that have a native renderer in v1. An agent-supplied kind outside
// this set renders the quiet fallback, never a mismatched card (a "booking"
// must not draw as a product with an "Add to cart" CTA).
export const RENDERABLE_KINDS = new Set(['product', 'form']);

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
