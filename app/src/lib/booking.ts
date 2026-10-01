// lib/booking.ts — the `book_slot` card's data: parse what the server hydrated,
// and decide which calendar link may be shown.
//
// The model writes `{type: "book_slot", props: {slot_ids, session_type, name?,
// email?, notes?}}`; the server swaps the ids for real slots from its
// availability snapshot (dropping unknown or expired ones) before the card
// reaches the bar. parseBookSlot reads that hydrated shape:
//   session_type: {id, label, duration_min?} | "<id>"
//   slots:        [{slot_id, label, start?}]   1..MAX_SLOTS, labels already in
//                                              the visitor's timezone
//   name?, email?, notes?                      prefill from the conversation
// Everything is untrusted text: clipped, control characters dropped, rendered
// only through Svelte text/value bindings. A card with no usable slot or no
// session type id returns null and draws nothing. parseSlots also reads the
// `alternatives` a 409 slot_taken refusal carries.
//
// safeIcsUrl keeps the add-to-calendar link only when it is https, or a path
// on the API's own origin (resolved against the action endpoint). Anything
// else (javascript:, data:, //host, another http origin) is dropped.

import { cleanCardText } from './visitor-input';

export const BOOK_SLOT_VERB = 'book_slot';
export const MAX_SLOTS = 4;
/** Prefill caps, matching the server's book_slot checks. */
export const BOOKING_FIELD_MAX = { name: 120, email: 254, notes: 1000 } as const;

export interface BookingSlot {
  slot_id: string;
  label: string;
  /** ISO start time, when the server sent one. */
  start?: string;
}

export interface SessionType {
  id: string;
  label: string;
  duration_min?: number;
}

export interface BookSlotCard {
  session: SessionType;
  slots: BookingSlot[];
  name: string;
  email: string;
  notes: string;
}

const ID = /^[\w.:-]{1,64}$/;

/** Hydrated slots (or a 409's alternatives): deduped by id, at most MAX_SLOTS. */
export function parseSlots(raw: unknown): BookingSlot[] {
  if (!Array.isArray(raw)) return [];
  const slots: BookingSlot[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const slot_id = typeof r.slot_id === 'string' ? r.slot_id.trim() : '';
    const label = cleanCardText(r.label, 80);
    if (!ID.test(slot_id) || !label || slots.some((s) => s.slot_id === slot_id)) continue;
    const start = typeof r.start === 'string' && !Number.isNaN(Date.parse(r.start)) ? r.start : undefined;
    slots.push({ slot_id, label, ...(start ? { start } : {}) });
    if (slots.length === MAX_SLOTS) break;
  }
  return slots;
}

function parseSession(raw: unknown): SessionType | null {
  if (typeof raw === 'string') {
    const id = raw.trim();
    return ID.test(id) ? { id, label: cleanCardText(id, 80) } : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  if (!ID.test(id)) return null;
  const d = r.duration_min;
  const duration = typeof d === 'number' && Number.isInteger(d) && d > 0 && d <= 1440 ? d : undefined;
  return { id, label: cleanCardText(r.label, 80) || id, ...(duration ? { duration_min: duration } : {}) };
}

/** The hydrated book_slot props, or null when there is nothing to book. */
export function parseBookSlot(props: Record<string, unknown>): BookSlotCard | null {
  const session = parseSession(props.session_type);
  const slots = parseSlots(props.slots);
  if (!session || slots.length === 0) return null;
  return {
    session,
    slots,
    name: cleanCardText(props.name, BOOKING_FIELD_MAX.name),
    email: cleanCardText(props.email, BOOKING_FIELD_MAX.email),
    notes: cleanCardText(props.notes, BOOKING_FIELD_MAX.notes),
  };
}

/** The add-to-calendar href to show, or '' to show none. */
export function safeIcsUrl(url: unknown, endpoint: string): string {
  if (typeof url !== 'string') return '';
  const u = url.trim();
  if (!u) return '';
  let api: string;
  try {
    api = new URL(endpoint, globalThis.location?.href).origin;
  } catch {
    api = '';
  }
  // A path must start with exactly one slash: `//host` and `/\host` leave the API.
  if (u.startsWith('/')) {
    if (!api || /^\/[/\\]/.test(u)) return '';
    try {
      const resolved = new URL(u, api);
      return resolved.origin === api ? resolved.href : '';
    } catch {
      return '';
    }
  }
  try {
    const parsed = new URL(u);
    if (parsed.protocol === 'https:') return parsed.href;
    return parsed.protocol === 'http:' && parsed.origin === api ? parsed.href : '';
  } catch {
    return '';
  }
}
