// form-card.svelte.ts — Runes store for one kind:"form" pawbar-card. Owns the
// per-card submit flow so FormCard.svelte stays a renderer and the flow tests
// headlessly (tests/form-card.spec.ts, tests/lead-form.spec.ts).
//   * values — visitor input, seeded from each field's prefill `value` and
//     length-capped per field (maxFor). Text only; values ride the structured
//     action body and NEVER enter the transcript, markdown, or localStorage.
//     No path clears them: a failed submit keeps everything typed.
//   * A gated verb (any declared owner action): every field is required
//     (trimmed non-empty; a number field must parse finite). Posts through
//     CartStore.runAction; ok (auto ran, or gated → parked pending) → phase
//     'sent' and onSent, which FormCard wires to ContactStore.maybeOffer so the
//     decision-poll → email-capture machinery runs. Values cap at 256, the
//     executor's string-arg cap.
//   * The built-in LEAD_VERB ("send_to_team"): sends the visitor's details to
//     the team as a lead. Fields are optional except that `email` or `phone`
//     must be filled, and filled email/tel fields must look right (the server
//     checks again). Caps follow the server: name 120, message 2000. The result
//     is immediate (no decision to poll, so no onSent): phase 'sent' with the
//     server's `result.message`, and the card locks read-only. Refusals go
//     through lib/visitor-input.actionFailure: 429 → wait, 422 with a field →
//     that field's error, anything else → retry.

import { LEAD_VERB, type FormField, type PawBarCard } from '../lib/cards';
import { actionFailure, cleanCardText, looksLikeEmail, looksLikePhone, RETRY_MESSAGE } from '../lib/visitor-input';
import type { CartStore } from './cart.svelte';

export type FormCardPhase = 'idle' | 'submitting' | 'sent';

/** The executor caps string args at 256 chars — mirror it client-side. */
export const FORM_VALUE_MAX = 256;
/** Per-field caps for a lead, matching the server's send_to_team checks. */
export const LEAD_FIELD_MAX: Record<string, number> = { name: 120, email: 254, phone: 40, message: 2000 };
export const LEAD_SENT_FALLBACK = 'Sent. The team will get back to you.';
export const LEAD_NEEDS_CONTACT = 'Add an email or phone number so the team can reply.';

export class FormCardStore {
  values = $state<Record<string, string>>({});
  phase = $state<FormCardPhase>('idle');
  error = $state<string | null>(null);
  /** Per-field messages (lead form only), keyed by field name. */
  fieldErrors = $state<Record<string, string>>({});
  /** What the server said when a lead went through. */
  sentMessage = $state<string | null>(null);

  readonly isLead: boolean;
  #verb: string;
  #fields: FormField[];
  #cart: CartStore;
  #onSent?: () => void;

  constructor(card: PawBarCard, cart: CartStore, onSent?: () => void) {
    this.#verb = card.verb ?? '';
    this.isLead = this.#verb === LEAD_VERB;
    this.#fields = card.fields ?? [];
    this.#cart = cart;
    this.#onSent = onSent;
    const init: Record<string, string> = {};
    for (const f of this.#fields) init[f.name] = (f.value ?? '').slice(0, this.maxFor(f.name));
    this.values = init;
  }

  /** The longest value a field takes. */
  maxFor(name: string): number {
    return this.isLead ? (LEAD_FIELD_MAX[name] ?? FORM_VALUE_MAX) : FORM_VALUE_MAX;
  }

  setValue(name: string, value: string): void {
    this.values = { ...this.values, [name]: value.slice(0, this.maxFor(name)) };
  }

  /** Field names that fail the gated-verb all-required check (empty, or a
   *  number field that doesn't parse to a finite number). */
  get missing(): string[] {
    return this.#fields
      .filter((f) => {
        const v = (this.values[f.name] ?? '').trim();
        if (!v) return true;
        return f.type === 'number' && !Number.isFinite(Number(v));
      })
      .map((f) => f.name);
  }

  /** Lead-form checks: per-field format errors, then the email-or-phone rule. */
  #checkLead(): boolean {
    const errors: Record<string, string> = {};
    for (const f of this.#fields) {
      const v = (this.values[f.name] ?? '').trim();
      if (!v) continue;
      if (f.type === 'email' && !looksLikeEmail(v)) errors[f.name] = 'Enter a valid email address.';
      else if (f.type === 'tel' && !looksLikePhone(v)) errors[f.name] = 'Enter a valid phone number.';
      else if (f.type === 'number' && !Number.isFinite(Number(v))) errors[f.name] = 'Enter a number.';
    }
    this.fieldErrors = errors;
    if (Object.keys(errors).length > 0) {
      this.error = null;
      return false;
    }
    const reachable = ['email', 'phone'].some((n) => (this.values[n] ?? '').trim());
    this.error = reachable ? null : LEAD_NEEDS_CONTACT;
    return reachable;
  }

  /** Build the typed args body: number fields as numbers, the rest trimmed
   *  strings. Only declared field names are ever sent; a lead leaves empty
   *  optional fields off. */
  #args(): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    for (const f of this.#fields) {
      const v = (this.values[f.name] ?? '').trim().slice(0, this.maxFor(f.name));
      if (this.isLead && !v) continue;
      args[f.name] = f.type === 'number' ? Number(v) : v;
    }
    return args;
  }

  async submit(): Promise<void> {
    if (this.phase !== 'idle' || !this.#verb) return;
    if (this.isLead) return this.#submitLead();
    if (this.missing.length > 0) {
      this.error = 'Please fill in every field.';
      return;
    }
    this.error = null;
    this.phase = 'submitting';
    try {
      const ok = await this.#cart.runAction(this.#verb, this.#args(), `form:${this.#verb}`);
      if (ok) {
        this.phase = 'sent';
        this.#onSent?.();
      } else {
        this.phase = 'idle';
        this.error = this.#cart.error ?? RETRY_MESSAGE;
      }
    } catch {
      this.phase = 'idle';
      this.error = RETRY_MESSAGE;
    }
  }

  async #submitLead(): Promise<void> {
    if (!this.#checkLead()) return;
    this.phase = 'submitting';
    try {
      const res = await this.#cart.act(this.#verb, this.#args(), `form:${this.#verb}`);
      if (res.ok) {
        this.sentMessage = cleanCardText(res.result?.message, 300) || LEAD_SENT_FALLBACK;
        this.phase = 'sent';
        return;
      }
      const failure = actionFailure(res, this.#fields.map((f) => f.name));
      this.phase = 'idle';
      this.fieldErrors = failure.field ? { [failure.field]: failure.message } : {};
      this.error = failure.field ? null : failure.message;
    } catch {
      this.phase = 'idle';
      this.error = RETRY_MESSAGE;
    }
  }
}
