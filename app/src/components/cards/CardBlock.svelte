<!--
  CardBlock.svelte — Parses a `pawbar-card` fence body and dispatches it to a
  renderer by kind. Created 2026-07-15 (C2 action loop); 2026-07-16: owns the
  parse + kind gate + fallback (moved out of Markdown.svelte). Takes the raw JSON
  string the fence interceptor captured, validates it (cards.parseCard, which
  never throws and coerces every field), and renders native glass components via
  Svelte props only — no HTML injection, the DOMPurify markdown path is
  untouched. A malformed / stream-truncated card (parseCard → null) OR an unknown
  kind (isRenderable → false) renders a quiet muted "card unavailable" line, with
  the raw fence stayed hidden. Product is the only v1 kind; future kinds (booking
  form, gallery, contact) add a RENDERABLE_KINDS entry + a branch here without
  touching the fence interceptor or the markdown core.
-->
<script lang="ts">
  import { parseCard, isRenderable } from '../../lib/cards';
  import ProductCard from './ProductCard.svelte';

  let { json }: { json: string } = $props();
  const card = $derived(parseCard(json));
</script>

{#if card && isRenderable(card)}
  <ProductCard items={card.items} />
{:else}
  <p class="card-fallback" role="status">Card unavailable</p>
{/if}

<style>
  .card-fallback {
    margin: 8px 0;
    font-size: 12.5px;
    font-style: italic;
    color: var(--pawbar-fg-muted);
  }
</style>
