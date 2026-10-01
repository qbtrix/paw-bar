// book-slot.svelte.ts — Runes store for one `book_slot` card: the visitor picks
// a slot, checks the prefilled name/email/notes, and confirms. The concierge
// books in the conversation; this store only carries the visitor's tap to the
// server (POST /paw-bar/action through CartStore.act) and shows the outcome.
// Tested headlessly in tests/book-slot.spec.ts.
//
// Contract with pocketpaw (paw_bar/booking.py):
//   args    {slot_id, session_type: <session id>, name, email, notes, idem}
//           `idem` is `<card nonce>:<slot_id>`, stable for the card and slot,
//           so a double tap or a retry never books twice. The action client
//           sends no custom headers (CORS preflight), hence an arg.
//   200     result {status: "booked", label, ics_url?} → "Booked for <label>"
//           plus an add-to-calendar link when safeIcsUrl keeps it; or
//           result {status: "requested", message} (ask-me-first) → the message.
//           Either way the card locks.
//   409     detail {code: "slot_taken", alternatives: [{slot_id, label, start}]}
//           → the slot list is replaced in place and the visitor is told.
//   429 / 422 {field, message} / other → lib/visitor-input.actionFailure.
// Typed values are never cleared; only a success locks them.

import type { BookingSlot, BookSlotCard } from '../lib/booking';
import { BOOK_SLOT_VERB, BOOKING_FIELD_MAX, parseSlots, safeIcsUrl } from '../lib/booking';
import { actionFailure, cleanCardText, looksLikeEmail, RETRY_MESSAGE } from '../lib/visitor-input';
import type { CartStore } from './cart.svelte';

export type BookSlotPhase = 'idle' | 'submitting' | 'booked' | 'requested';
export type BookingField = keyof typeof BOOKING_FIELD_MAX;

export const SLOT_TAKEN = 'That time was just taken. Here are the next open times.';
export const SLOT_TAKEN_NONE = 'That time was just taken. Ask in the chat for other times.';
export const REQUESTED_FALLBACK = "Requested. You'll get an email when it's confirmed.";

function nonce(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function slotTaken(detail: unknown): { alternatives: unknown } | null {
  if (detail === 'slot_taken') return { alternatives: [] };
  if (detail && typeof detail === 'object' && (detail as { code?: unknown }).code === 'slot_taken') {
    return { alternatives: (detail as { alternatives?: unknown }).alternatives };
  }
  return null;
}

export class BookSlotStore {
  slots = $state<BookingSlot[]>([]);
  selected = $state<string | null>(null);
  values = $state<Record<BookingField, string>>({ name: '', email: '', notes: '' });
  phase = $state<BookSlotPhase>('idle');
  error = $state<string | null>(null);
  fieldErrors = $state<Partial<Record<BookingField, string>>>({});
  /** Set when the picked slot was taken and the list changed under the visitor. */
  notice = $state<string | null>(null);
  /** The booked time, the add-to-calendar href, or the ask-me-first message. */
  bookedLabel = $state('');
  icsUrl = $state('');
  message = $state('');

  readonly session: BookSlotCard['session'];
  #cart: CartStore;
  #nonce = nonce();

  constructor(card: BookSlotCard, cart: CartStore) {
    this.session = card.session;
    this.#cart = cart;
    this.slots = card.slots;
    this.selected = card.slots.length === 1 ? card.slots[0].slot_id : null;
    this.values = { name: card.name, email: card.email, notes: card.notes };
  }

  get locked(): boolean {
    return this.phase === 'booked' || this.phase === 'requested';
  }

  /** The idempotency key sent with a confirm of `slotId` from this card. */
  idemFor(slotId: string): string {
    return `${this.#nonce}:${slotId}`;
  }

  select(slotId: string): void {
    if (this.locked || this.phase === 'submitting') return;
    if (this.slots.some((s) => s.slot_id === slotId)) this.selected = slotId;
  }

  setValue(name: BookingField, value: string): void {
    this.values = { ...this.values, [name]: value.slice(0, BOOKING_FIELD_MAX[name]) };
  }

  #check(): boolean {
    const email = this.values.email.trim();
    const errors: Partial<Record<BookingField, string>> = {};
    if (!email) errors.email = 'Add your email so we can send the invite.';
    else if (!looksLikeEmail(email)) errors.email = 'Enter a valid email address.';
    this.fieldErrors = errors;
    this.error = this.selected ? null : 'Pick a time first.';
    return !errors.email && !!this.selected;
  }

  async confirm(): Promise<void> {
    if (this.phase !== 'idle' || !this.#check()) return;
    const slot = this.slots.find((s) => s.slot_id === this.selected)!;
    this.phase = 'submitting';
    this.notice = null;
    try {
      const res = await this.#cart.act(
        BOOK_SLOT_VERB,
        {
          slot_id: slot.slot_id,
          session_type: this.session.id,
          name: this.values.name.trim(),
          email: this.values.email.trim(),
          notes: this.values.notes.trim(),
          idem: this.idemFor(slot.slot_id),
        },
        `${BOOK_SLOT_VERB}:${slot.slot_id}`,
      );
      if (res.ok) return this.#done(res.result ?? {}, slot);
      this.phase = 'idle';
      const taken = res.status === 409 ? slotTaken(res.detail) : null;
      if (taken) {
        const alternatives = parseSlots(taken.alternatives);
        if (alternatives.length) this.slots = alternatives;
        this.selected = alternatives.length === 1 ? alternatives[0].slot_id : null;
        if (!alternatives.length) this.slots = this.slots.filter((s) => s.slot_id !== slot.slot_id);
        this.notice = alternatives.length ? SLOT_TAKEN : SLOT_TAKEN_NONE;
        return;
      }
      const failure = actionFailure(res, Object.keys(BOOKING_FIELD_MAX));
      this.fieldErrors = failure.field ? { [failure.field]: failure.message } : {};
      this.error = failure.field ? null : failure.message;
    } catch {
      this.phase = 'idle';
      this.error = RETRY_MESSAGE;
    }
  }

  #done(result: Record<string, unknown>, slot: BookingSlot): void {
    if (result.status === 'booked') {
      this.bookedLabel = cleanCardText(result.label, 120) || slot.label;
      this.icsUrl = safeIcsUrl(result.ics_url, this.#cart.endpoint);
      this.phase = 'booked';
      return;
    }
    this.message = cleanCardText(result.message, 300) || REQUESTED_FALLBACK;
    this.phase = 'requested';
  }
}
