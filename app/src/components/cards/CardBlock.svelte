<!--
  CardBlock.svelte — Parses a `pawbar-card` fence body and dispatches it to a
  renderer by kind. Created 2026-07-15 (C2 action loop); 2026-07-16: owns the
  parse + kind gate + fallback (moved out of Markdown.svelte). Takes the raw JSON
  string the fence interceptor captured, validates it (cards.parseCard, which
  never throws and coerces every field), and renders native glass components via
  Svelte props only — no HTML injection, the DOMPurify markdown path is
  untouched. A malformed / stream-truncated card (parseCard → null) OR an unknown
  kind (isRenderable → false) renders a quiet muted "card unavailable" line, with
  the raw fence stayed hidden. 2026-07-30 (form cards): kind "form" branches to
  FormCard — the structured gated-action detail collector; product keeps its
  branch. Future kinds (gallery, contact) add a RENDERABLE_KINDS entry + a
  branch here without touching the fence interceptor or the markdown core.
  2026-09-27 (Paw Bar states, E2/E3): a card with no cart store in context
  (useCart() is undefined outside a shell that provides one) takes the same
  "Card unavailable" fallback instead of throwing at render. Inside the new
  bar's thread (inBarThread), product cards render through BarCatalog and the
  fallback drops role=status: the thread is the bar's one live region.
-->
<script lang="ts">
  import { parseCard, isRenderable } from '../../lib/cards';
  import ProductCard from './ProductCard.svelte';
  import FormCard from './FormCard.svelte';
  import BarCatalog from '../bar/BarCatalog.svelte';
  import { useCart } from '../../store/cart.svelte';
  import { inBarThread } from './thread';

  let { json }: { json: string } = $props();
  const card = $derived(parseCard(json));
  // Both renderers act through the cart store; without one a card can do nothing.
  const cart = useCart();
  const thread = inBarThread();
</script>

{#if cart && card && isRenderable(card) && card.kind === 'form'}
  <FormCard {card} />
{:else if cart && card && isRenderable(card) && thread}
  <BarCatalog items={card.items} />
{:else if cart && card && isRenderable(card)}
  <ProductCard items={card.items} />
{:else}
  <p class="card-fallback" role={thread ? undefined : 'status'}>Card unavailable</p>
{/if}

<style>
  .card-fallback {
    margin: 8px 0;
    font-size: 12.5px;
    font-style: italic;
    color: var(--pawbar-fg-muted);
  }
</style>
