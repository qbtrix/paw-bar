// contact.svelte.ts — Runes store for the "Leaving? We can email you" prompt
// (the Crisp just-in-case-you-leave moment). Created 2026-07-30 (email capture
// on pending decisions). Owns the prompt lifecycle so GlassShell stays a
// renderer and the flow tests headlessly with a mocked fetch:
//   * maybeOffer() — called after an assistant turn reaches a rest state; ONE
//     poll of the decision endpoint (no polling loop), guarded by the
//     localStorage contact flag, the session dismiss flag, and an in-flight
//     latch. state=pending → status 'offer'; anything else (including an old
//     backend without the endpoint) stays hidden, silently.
//   * submit(email) — POST decision-contact. ok → set the per-widget flag +
//     'sent' (quiet confirmation); 422 → inline emailError; any other failure
//     → dismiss quietly. The email lives ONLY in the component input and this
//     request body — never in the transcript, the chat store, storage, or logs.
//   * dismiss() — ✕: hide now and never re-offer this session.
// 2026-07-30 (form cards): + provideContact/useContact context helpers (mirror
// of cart.svelte's pair) so a nested FormCard can nudge maybeOffer() after a
// gated form submit parks a pending decision — same self-guarded single poll.

import { getContext, setContext } from 'svelte';
import type { ConciergeChatConfig } from '../lib/chat-client';
import { getCustomerRef } from '../lib/customer-ref';
import {
  getDecisionStatus,
  hasContactFlag,
  postDecisionContact,
  setContactFlag,
} from '../lib/decision-contact';

export type ContactPromptStatus = 'hidden' | 'offer' | 'sent';

export interface ContactStoreConfig {
  endpoint: string;
  widgetId: string;
  siteKey: string;
}

const CONTACT_KEY = Symbol('pawbar-contact');

/** Called once in the shell so nested cards can reach the contact prompt. */
export function provideContact(store: ContactStore): void {
  setContext(CONTACT_KEY, store);
}
/** Undefined outside the shell tree (e.g. isolated component tests). */
export function useContact(): ContactStore | undefined {
  return getContext<ContactStore | undefined>(CONTACT_KEY);
}

export class ContactStore {
  status = $state<ContactPromptStatus>('hidden');
  emailError = $state(false);
  isSubmitting = $state(false);

  #config: ContactStoreConfig;
  #dismissed = false; // session-only: never re-render after ✕
  #inFlight = false;

  constructor(config: ContactStoreConfig) {
    this.#config = config;
  }

  async #clientConfig(): Promise<ConciergeChatConfig> {
    return {
      endpoint: this.#config.endpoint,
      widgetId: this.#config.widgetId,
      signedKey: this.#config.siteKey,
      customerRef: await getCustomerRef(this.#config.widgetId),
    };
  }

  /** One decision-status check after a finished assistant turn. Skips the
   *  network entirely when the visitor already left contact, dismissed the
   *  prompt this session, or the prompt is already up. */
  async maybeOffer(): Promise<void> {
    if (this.status !== 'hidden' || this.#dismissed || this.#inFlight) return;
    if (hasContactFlag(this.#config.widgetId)) return;
    this.#inFlight = true;
    try {
      const decision = await getDecisionStatus(await this.#clientConfig());
      if (decision?.found && decision.state === 'pending' && !this.#dismissed && this.status === 'hidden') {
        this.status = 'offer';
      }
    } finally {
      this.#inFlight = false;
    }
  }

  async submit(email: string): Promise<void> {
    const trimmed = email.trim();
    if (this.isSubmitting || this.status !== 'offer') return;
    if (!trimmed) {
      this.emailError = true;
      return;
    }
    this.emailError = false;
    this.isSubmitting = true;
    try {
      const result = await postDecisionContact(await this.#clientConfig(), trimmed);
      if (result === 'ok') {
        setContactFlag(this.#config.widgetId);
        this.status = 'sent';
      } else if (result === 'invalid_email') {
        this.emailError = true;
      } else {
        // Rate-limited / refused / old backend — vanish quietly, never block chat.
        this.status = 'hidden';
        this.#dismissed = true;
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  dismiss(): void {
    this.#dismissed = true;
    this.status = 'hidden';
    this.emailError = false;
  }
}
