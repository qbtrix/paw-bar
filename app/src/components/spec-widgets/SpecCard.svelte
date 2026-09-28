<!--
  SpecCard.svelte — a generated UI block in the thread: a Ripple spec drawn by
  the spec renderer with the Paw Bar's own widgets. Created 2026-09-27.

  CardBlock hands it a spec that lib/spec-card.ts has already bounded. Local
  actions (set, toggle, push, remove, open) run inside the spec. Host events
  are mapped to bar actions here, and only these two exist:
    • emit `add_to_cart` with { product_id, qty? } → the cart store
    • emit `checkout` → opens the checkout link in a new tab
  Everything else a spec can send (navigate, toast, pin, any other emit) is
  ignored: a reply must never move the customer's page or act on its own.
  Product and form widgets act through the cart store directly, as legacy cards
  do, so a spec rarely needs these emits; they exist for buttons.

  The spec's own `theme` is dropped when the card is parsed: the bar follows the
  site owner's styling, and an agent-written spec doesn't get to recolour it.

  2026-09-28: emits outside SPEC_HOST_EVENTS (lib/spec-card.ts) return early;
  that list is pinned against pocketpaw's server list by the card-parity
  fixtures (tests/card-parity.spec.ts).
-->
<script lang="ts">
  import type { OnEventCallback, UISpec } from '@ripple-ui/core/headless/slim';
  import SpecRenderer from '../spec/SpecRenderer.svelte';
  import SpecUnavailable from './SpecUnavailable.svelte';
  import { SPEC_WIDGETS } from './registry';
  import { SPEC_HOST_EVENTS } from '../../lib/spec-card';
  import { useCart } from '../../store/cart.svelte';

  let { spec }: { spec: UISpec } = $props();
  const cart = useCart();

  const onEvent: OnEventCallback = (event) => {
    if (event.type !== 'emit' || !cart) return;
    if (!(SPEC_HOST_EVENTS as readonly string[]).includes(event.name ?? '')) return;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.name === 'add_to_cart') {
      const id = typeof payload.product_id === 'string' ? payload.product_id : '';
      const qty = typeof payload.qty === 'number' && Number.isFinite(payload.qty) ? payload.qty : 1;
      if (id) void cart.addToCart(id, qty);
    } else if (event.name === 'checkout') {
      cart.openCheckout();
    }
  };
</script>

<div class="spec-card"><SpecRenderer {spec} components={SPEC_WIDGETS} {onEvent} fallback={SpecUnavailable} /></div>

<style>
  .spec-card {
    margin: 8px 0;
    min-width: 0;
  }
</style>
