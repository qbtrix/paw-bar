<!--
  SpecProducts.svelte — the `product-card` widget: one or more products with
  their add-to-cart and checkout buttons. Created 2026-09-27.

  It is the existing catalog (bar/BarCatalog.svelte), not a new component. The
  `items` prop goes through lib/cards.parseCard exactly as a legacy
  `{"kind":"product"}` card does, so every field is validated and coerced the
  same way (safe image URLs, deduped verbs, no item without a name). Anything
  that doesn't survive draws the quiet "Card unavailable" line. Items are
  meant to be filled in by the server from the site's catalog; the model sends
  ids.
-->
<script lang="ts">
  import BarCatalog from '../bar/BarCatalog.svelte';
  import { parseCard } from '../../lib/cards';
  import { useCart } from '../../store/cart.svelte';

  let { items }: { items?: unknown } = $props();

  const card = $derived(parseCard(JSON.stringify({ kind: 'product', items: Array.isArray(items) ? items : [] })));
  const cart = useCart();
</script>

{#if cart && card && card.items.length}
  <BarCatalog items={card.items} />
{:else}
  <p class="spec-unavailable">Card unavailable</p>
{/if}

<style>
  .spec-unavailable {
    margin: 0;
    font-size: 12.5px;
    font-style: italic;
    color: var(--pawbar-thread-muted, var(--pawbar-fg-muted));
  }
</style>
