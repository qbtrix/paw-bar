// form-card.svelte.ts — Runes store for one kind:"form" pawbar-card. Created
// 2026-07-30 (form cards). Owns the per-card submit flow so FormCard.svelte
// stays a renderer and the flow tests headlessly (tests/form-card.spec.ts):
//   * values — visitor input, length-capped at 256 (the executor's arg cap).
//     Text only; values ride the structured action body and NEVER enter the
//     transcript, markdown, or localStorage.
//   * submit() — v1: every field is required (trimmed non-empty; a number
//     field must parse finite). Posts through CartStore.runAction so the
//     card reuses the shared /paw-bar/action transport + pending state.
//     Number-typed fields are coerced to real numbers so int/float args
//     arrive typed, not as strings.
//   * ok (auto ran, or gated → parked pending) → phase 'sent': the card swaps
//     to a quiet confirmation and fires onSent, which the component wires to
//     ContactStore.maybeOffer so the existing decision-poll → email-capture
//     machinery runs naturally. 4xx / network → phase back to 'idle' with an
//     inline error; entered values are kept so the visitor can fix + resend.

import type { FormField, PawBarCard } from '../lib/cards';
import type { CartStore } from './cart.svelte';

export type FormCardPhase = 'idle' | 'submitting' | 'sent';

/** The executor caps string args at 256 chars — mirror it client-side. */
export const FORM_VALUE_MAX = 256;

export class FormCardStore {
  values = $state<Record<string, string>>({});
  phase = $state<FormCardPhase>('idle');
  error = $state<string | null>(null);

  #verb: string;
  #fields: FormField[];
  #cart: CartStore;
  #onSent?: () => void;

  constructor(card: PawBarCard, cart: CartStore, onSent?: () => void) {
    this.#verb = card.verb ?? '';
    this.#fields = card.fields ?? [];
    this.#cart = cart;
    this.#onSent = onSent;
    const init: Record<string, string> = {};
    for (const f of this.#fields) init[f.name] = '';
    this.values = init;
  }

  setValue(name: string, value: string): void {
    this.values = { ...this.values, [name]: value.slice(0, FORM_VALUE_MAX) };
  }

  /** Field names that fail the v1 all-required check (empty, or a number
   *  field that doesn't parse to a finite number). */
  get missing(): string[] {
    return this.#fields
      .filter((f) => {
        const v = (this.values[f.name] ?? '').trim();
        if (!v) return true;
        return f.type === 'number' && !Number.isFinite(Number(v));
      })
      .map((f) => f.name);
  }

  /** Build the typed args body: number fields as numbers, the rest trimmed
   *  strings. Only declared field names are ever sent. */
  #args(): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    for (const f of this.#fields) {
      const v = (this.values[f.name] ?? '').trim().slice(0, FORM_VALUE_MAX);
      args[f.name] = f.type === 'number' ? Number(v) : v;
    }
    return args;
  }

  async submit(): Promise<void> {
    if (this.phase !== 'idle' || !this.#verb) return;
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
        this.error = this.#cart.error ?? 'That didn’t go through — please try again.';
      }
    } catch {
      this.phase = 'idle';
      this.error = 'That didn’t go through — please try again.';
    }
  }
}
