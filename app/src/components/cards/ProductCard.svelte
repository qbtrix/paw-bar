<!--
  ProductCard.svelte — Native glass product cards for a `pawbar-card` block.
  Created 2026-07-15 (C2 action loop). Renders each item (image / name / price /
  description) with its allowlisted action CTAs. Every field is a Svelte
  text/attribute binding — NO HTML injection, the DOMPurify markdown path is
  untouched. CTA clicks post STRUCTURED action events through the cart store
  (never free text); the server validates + mutates the visitor cart. `checkout`
  is a handoff to the site's real checkout, opened in the click gesture.
  2026-08-19: a thumbnail that fails to load removes itself instead of leaving a
  broken-image box on the customer's own storefront, and decodes off the main
  thread so a heavy image cannot stall a streaming reply.
-->
<script lang="ts">
  import type { CardItem } from '../../lib/cards';
  import { verbLabel, formatPrice, safeImageUrl } from '../../lib/cards';
  import { useCart } from '../../store/cart.svelte';

  let { items }: { items: CardItem[] } = $props();
  const cart = useCart();

  // Product artwork is owner/agent-supplied and lives on somebody else's CDN.
  // A URL that 404s leaves a broken-image box on a CUSTOMER's site, which is
  // the widget visibly failing on their storefront. HomeTab's team avatars
  // already remove themselves on error; this is the same rule for the same
  // reason. Held as a Set rather than by mutating the prop, so a re-render from
  // the parent cannot resurrect a URL we already watched fail.
  let brokenImages = $state(new Set<string>());

  let justAdded = $state<Record<string, boolean>>({});

  function isPending(verb: string, item: CardItem): boolean {
    return cart.pending === (verb === 'add_to_cart' ? `add_to_cart:${item.id}` : verb);
  }

  async function onAction(verb: string, item: CardItem) {
    if (verb === 'checkout') {
      doCheckout();
      return;
    }
    if (verb === 'add_to_cart') {
      if (!item.id) return;
      const ok = await cart.addToCart(item.id);
      if (ok) {
        justAdded = { ...justAdded, [item.id]: true };
        setTimeout(() => {
          const next = { ...justAdded };
          delete next[item.id];
          justAdded = next;
        }, 1400);
      }
      return;
    }
    // Gated / other declared verbs — the server validates + may emit a proposal.
    void cart.runAction(verb, {});
  }

  function doCheckout() {
    // Synchronous open (inside the click gesture) + server-side intent log,
    // both owned by the store so the card CTA and header badge stay in sync.
    cart.openCheckout();
  }

  function ctaLabel(verb: string, item: CardItem): string {
    if (verb === 'add_to_cart' && item.id && justAdded[item.id]) return 'Added ✓';
    if (isPending(verb, item)) return verb === 'add_to_cart' ? 'Adding…' : 'Working…';
    return verbLabel(verb);
  }
</script>

<div class="cards">
  {#each items as item (item.id || item.name)}
    {@const rawImg = item.image_url ?? ''}
    {@const img = brokenImages.has(rawImg) ? '' : safeImageUrl(rawImg)}
    <article class="card">
      {#if img}
        <img
          class="thumb"
          src={img}
          alt={item.name}
          loading="lazy"
          decoding="async"
          onerror={() => (brokenImages = new Set(brokenImages).add(rawImg))}
        />
      {/if}
      <div class="body">
        <div class="titleRow">
          <span class="name">{item.name}</span>
          {#if formatPrice(item.price_cents, item.currency)}
            <span class="price">{formatPrice(item.price_cents, item.currency)}</span>
          {/if}
        </div>
        {#if item.description}
          <p class="desc">{item.description}</p>
        {/if}
        {#if item.actions.length > 0}
          <div class="ctas">
            <!-- Index: lib/cards dedupes the verb list, and the CTA row is
                 fixed-order with no state to preserve across a re-key. -->
            {#each item.actions as verb, i (i)}
              <button
                type="button"
                class="cta"
                class:primary={verb === 'add_to_cart'}
                disabled={isPending(verb, item) || (verb === 'add_to_cart' && !item.id)}
                onclick={() => onAction(verb, item)}
              >
                {ctaLabel(verb, item)}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </article>
  {/each}
</div>

<style>
  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 8px 0;
  }
  .card {
    display: flex;
    gap: 12px;
    padding: 10px;
    border: 1px solid var(--pawbar-border);
    border-radius: var(--pawbar-radius-md);
    background: var(--pawbar-assistant-bubble);
  }
  .thumb {
    flex: none;
    width: 64px;
    height: 64px;
    object-fit: cover;
    border-radius: var(--pawbar-radius-xs);
    background: color-mix(in oklab, var(--pawbar-fg) 8%, transparent);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .titleRow {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .name {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
  }
  .price {
    flex: none;
    font-size: 13px;
    font-weight: 600;
    color: var(--pawbar-accent);
  }
  .desc {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--pawbar-fg-muted);
  }
  .ctas {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }
  .cta {
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    padding: 6px 12px;
    border-radius: var(--pawbar-radius-xs);
    border: 1px solid var(--pawbar-border);
    background: none;
    color: var(--pawbar-fg);
    cursor: pointer;
    transition: background 0.14s ease, opacity 0.14s ease;
  }
  .cta:hover:not(:disabled) {
    background: color-mix(in oklab, var(--pawbar-fg) 8%, transparent);
  }
  .cta.primary {
    background: var(--pawbar-accent);
    color: var(--pawbar-accent-fg);
    border-color: transparent;
  }
  .cta.primary:hover:not(:disabled) {
    background: color-mix(in oklab, var(--pawbar-accent) 88%, black);
  }
  .cta:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
