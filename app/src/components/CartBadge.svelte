<!--
  CartBadge.svelte — Header cart affordance + checkout handoff. Created
  2026-07-15 (C2 action loop). Shows the visitor cart count; clicking opens a
  compact popover with the line items, the server-computed total, and a Checkout
  button that hands off to the site's REAL checkout (opened in the click gesture
  so popup blockers don't eat it — the agent never executes payment). Reads the
  shared cart store from context; renders nothing until the cart has items.

  2026-08-19: RE-MOUNTED. The messenger refactor orphaned this component — it
  stopped being imported anywhere, while the docked bar kept a cart button
  labelled "open concierge" that led to a panel with no cart in it. The visitor
  action loop (C2) had no exit: the only surviving openCheckout() caller was a
  product card's own CTA, reachable only if the agent happened to re-emit one.
  It now sits in BOTH panel headers (tab surface and conversation), because
  those are the two places the visitor can be while the frame is large enough
  to hold a popover — the docked bar's iframe is content-sized, so a popover
  drawn there would be clipped away at the frame edge.

  2026-08-19: `open` moved onto the CartStore. It was local state, which is why
  this was the one overlay Escape could not dismiss: the shell peels overlays in
  order and had no way to see this one. It is also no longer role="dialog" —
  it is not modal, traps nothing, and claiming otherwise tells a screen-reader
  user the rest of the surface is inert when it is not.
-->
<script lang="ts">
  import { useCart } from '../store/cart.svelte';
  import { formatPrice } from '../lib/cards';

  const cart = useCart();
  let root: HTMLDivElement | null = $state(null);

  const total = $derived(cart.cart ? formatPrice(cart.cart.total_cents, cart.cart.currency) : '');

  function checkout() {
    // Shared checkout handoff: opens the guarded URL synchronously + logs intent.
    cart.openCheckout();
  }

  function lineTotal(line: { line_total_cents?: number; price_cents?: number; qty?: number }): string {
    const cents = line.line_total_cents ?? (line.price_cents ?? 0) * (line.qty ?? 1);
    return formatPrice(cents, cart.cart?.currency);
  }

  // Close the popover on an outside click while it's open.
  $effect(() => {
    if (!cart.popoverOpen) return;
    function onDocClick(e: MouseEvent) {
      if (root && !root.contains(e.target as Node)) cart.popoverOpen = false;
    }
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  });

  // An emptied cart must not leave a popover pointing at nothing. The badge
  // unmounts on count 0, and an unmounted popover that is still flagged open
  // would swallow the visitor's next Escape.
  $effect(() => {
    if (cart.count === 0) cart.popoverOpen = false;
  });
</script>

{#if cart.count > 0}
  <div class="cartRoot" bind:this={root}>
    <button
      type="button"
      class="badge"
      onclick={() => (cart.popoverOpen = !cart.popoverOpen)}
      aria-expanded={cart.popoverOpen}
      aria-label={`Cart, ${cart.count} item${cart.count === 1 ? '' : 's'}`}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          d="M6 6h15l-1.5 9h-12L5 3H2"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="9" cy="20" r="1.4" fill="currentColor" />
        <circle cx="17" cy="20" r="1.4" fill="currentColor" />
      </svg>
      <span class="count">{cart.count}</span>
    </button>

    {#if cart.popoverOpen}
      <div class="pop" role="group" aria-label="Cart">
        <ul class="lines">
          {#each cart.cart?.items ?? [] as line, i (line.id ?? line.product_id ?? i)}
            <li class="line">
              <span class="qty">{line.qty ?? 1}×</span>
              <span class="lname">{line.name ?? 'Item'}</span>
              <span class="lprice">{lineTotal(line)}</span>
            </li>
          {/each}
        </ul>
        <div class="totalRow">
          <span>Total</span>
          <span class="total">{total}</span>
        </div>
        <button type="button" class="checkout" onclick={checkout} disabled={!cart.checkoutUrl}>
          Checkout
        </button>
        {#if !cart.checkoutUrl}
          <p class="hint">Checkout link isn't ready yet.</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .cartRoot {
    position: relative;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--pawbar-border);
    border-radius: var(--pawbar-radius-pill);
    background: none;
    color: var(--pawbar-fg);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .badge:hover {
    background: color-mix(in oklab, var(--pawbar-fg) 8%, transparent);
  }
  .count {
    min-width: 14px;
    text-align: center;
  }
  .pop {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 5;
    width: 240px;
    padding: 10px;
    border: 1px solid var(--pawbar-border);
    border-radius: var(--pawbar-radius-sm);
    background: var(--pawbar-surface-strong);
    -webkit-backdrop-filter: blur(var(--pawbar-blur));
    backdrop-filter: blur(var(--pawbar-blur));
    box-shadow: inset 0 1px 0 var(--pawbar-wash-strong);
  }
  .lines {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    max-height: 200px;
    overflow-y: auto;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 0;
    font-size: 12.5px;
  }
  .qty {
    flex: none;
    color: var(--pawbar-fg-muted);
  }
  .lname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lprice {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .totalRow {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-top: 1px solid var(--pawbar-border);
    font-size: 13px;
    font-weight: 600;
  }
  .total {
    color: var(--pawbar-accent);
    font-variant-numeric: tabular-nums;
  }
  .checkout {
    width: 100%;
    margin-top: 4px;
    padding: 9px;
    border: none;
    border-radius: var(--pawbar-radius-xs);
    background: var(--pawbar-accent);
    color: var(--pawbar-accent-fg);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .checkout:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .hint {
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--pawbar-fg-muted);
    text-align: center;
  }
</style>
