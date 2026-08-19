// cart.svelte.ts — Svelte 5 runes store for the visitor cart + action loop.
// Created 2026-07-15 (C2 action loop). Holds the server-side visitor cart
// (never authoritative locally — every mutation round-trips /paw-bar/action and
// adopts the cart the server returns) plus in-flight + error state for CTA
// buttons. Shares the anonymous customer_ref with the chat store via the
// module-singleton getCustomerRef, so both surfaces key the same visitor. No DOM
// coupling — instantiable directly in a test with a mocked fetch
// (tests/cart.spec.ts). Provided to descendant card components via context so
// deeply-nested CTAs don't need prop drilling. load() is one-shot, wired to the
// first panel open for the initial cart hydrate.

import { getContext, setContext } from 'svelte';
import { postAction, getCart, type ActionConfig, type Cart } from '../lib/action-client';
import { getCustomerRef } from '../lib/customer-ref';

export interface CartStoreConfig {
  endpoint: string;
  widgetId: string;
  siteKey: string;
}

const CART_KEY = Symbol('pawbar-cart');

/** Called once in the shell so every descendant CTA can reach the cart. */
export function provideCart(store: CartStore): void {
  setContext(CART_KEY, store);
}
export function useCart(): CartStore {
  return getContext<CartStore>(CART_KEY);
}

export class CartStore {
  cart = $state<Cart | null>(null);
  error = $state<string | null>(null);
  /** The pending action key ("add_to_cart:<id>" / "checkout") for button state. */
  pending = $state<string | null>(null);

  #config: CartStoreConfig;
  #customerRef: string | null = null;
  #loadStarted = false;

  constructor(config: CartStoreConfig) {
    this.#config = config;
  }

  get count(): number {
    return this.cart?.items?.reduce((n, i) => n + (i.qty ?? 1), 0) ?? 0;
  }

  /** The server-rendered checkout link (cart_ref already filled), or null. Only
   *  http(s) is honoured — checkout is a handoff to the site's real checkout. */
  get checkoutUrl(): string | null {
    const u = this.cart?.checkout_url;
    return u && /^https?:\/\//i.test(u) ? u : null;
  }

  async #actionConfig(): Promise<ActionConfig> {
    if (!this.#customerRef) this.#customerRef = await getCustomerRef(this.#config.widgetId);
    return {
      endpoint: this.#config.endpoint,
      widgetId: this.#config.widgetId,
      signedKey: this.#config.siteKey,
      customerRef: this.#customerRef,
    };
  }

  /** Post a structured action event; adopt the returned cart. Returns success. */
  async runAction(verb: string, args: Record<string, unknown>, pendingKey?: string): Promise<boolean> {
    this.error = null;
    this.pending = pendingKey ?? verb;
    try {
      const res = await postAction(await this.#actionConfig(), verb, args);
      if (!res.ok) {
        this.error = res.error ?? 'That action didn’t go through.';
        return false;
      }
      if (res.cart) this.cart = res.cart;
      return true;
    } finally {
      this.pending = null;
    }
  }

  addToCart(productId: string, qty = 1): Promise<boolean> {
    return this.runAction('add_to_cart', { product_id: productId, qty }, `add_to_cart:${productId}`);
  }

  /** Log the checkout intent server-side (fire-and-forget); the agent never
   *  executes payment — checkout is a handoff to the site's REAL checkout. */
  logCheckout(): void {
    void this.runAction('checkout', {}, 'checkout');
  }

  /** Hand off to the site's real checkout. Opens the server-rendered, http(s)-
   *  guarded checkoutUrl in a new tab SYNCHRONOUSLY (call this straight from the
   *  click handler, before any await, so popup blockers don't eat it), then logs
   *  the intent server-side. Returns whether a tab was opened. Callers (the card
   *  CTA + the header CartBadge) share this one path. */
  openCheckout(): boolean {
    const url = this.checkoutUrl;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    this.logCheckout();
    return !!url;
  }

  /** Best-effort hydrate of an existing cart (e.g. returning visitor). One-shot:
   *  wired to the FIRST panel open, so a re-open (or a failed GET while the C1
   *  backend is down) doesn't re-fire the request every time the panel toggles.
   *  Action responses keep the cart fresh after this initial hydrate. */
  async load(): Promise<void> {
    if (this.#loadStarted) return;
    this.#loadStarted = true;
    const cart = await getCart(await this.#actionConfig());
    if (cart) this.cart = cart;
  }
}
