// lib/visitor-input.ts — checks and messages shared by the cards that send a
// visitor's details to the business: the `send_to_team` lead form
// (store/form-card.svelte.ts) and the `book_slot` booking card
// (store/book-slot.svelte.ts).
//
// - cleanCardText: agent- or server-supplied text that seeds an input (a form
//   field's `value`, a booking card's prefilled name). Plain text only, control
//   characters dropped, clipped by code point. It is only ever bound as an
//   input value, never parsed as HTML.
// - looksLikeEmail / looksLikePhone: the same rules as the server's
//   contact_form.looks_like_email / looks_like_phone (pocketpaw), never
//   stricter: a stricter client rejects real customers the server would take.
// - actionFailure: turns a failed POST /paw-bar/action (lib/action-client)
//   into what the card shows. 429 asks the visitor to wait; a 422 whose
//   `detail` names a field puts the server's message on that field; anything
//   else is a retry line. Server text is clipped and rendered as text.

import type { ActionResult } from './action-client';

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Untrusted text as an input's starting value: '' for non-strings. */
export function cleanCardText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
  const points = Array.from(text);
  return points.length > max ? points.slice(0, max).join('').trimEnd() : text;
}

/** One @, a dot in the domain, no whitespace. */
export function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

/** At least 7 digits once formatting (spaces, dashes, +, an extension) is dropped. */
export function looksLikePhone(value: string): boolean {
  return value.replace(/\D/g, '').length >= 7;
}

export const RETRY_MESSAGE = 'That didn’t go through — please try again.';
export const WAIT_MESSAGE = 'Please wait a moment, then try again.';

export interface ActionFailure {
  message: string;
  /** Set when the server pinned the error on one of the card's fields. */
  field?: string;
}

/** What a card shows for a failed action. `fields` are the names it renders. */
export function actionFailure(res: ActionResult, fields: readonly string[]): ActionFailure {
  if (res.status === 429) return { message: WAIT_MESSAGE };
  if (res.status === 422 && res.detail && typeof res.detail === 'object') {
    const { field, message } = res.detail as { field?: unknown; message?: unknown };
    if (typeof field === 'string' && fields.includes(field)) {
      const text = cleanCardText(message, 200);
      return { field, message: text || 'Please check this.' };
    }
  }
  return { message: RETRY_MESSAGE };
}
