<!--
  SpecForm.svelte — the `form` widget: collects the details a gated action
  needs (a booking, a callback) and submits them through the action path.
  Created 2026-09-27.

  It is the existing cards/FormCard.svelte. The props go through
  lib/cards.parseCard as a legacy `{"kind":"form"}` card would: a verb is
  required, at most 8 fields of type text / tel / email / number / textarea,
  and a repeated field name rejects the form. The server checks the verb and
  its args again when the form is submitted.
-->
<script lang="ts">
  import FormCard from '../cards/FormCard.svelte';
  import { parseCard } from '../../lib/cards';
  import { useCart } from '../../store/cart.svelte';

  let {
    verb,
    title,
    submit_label,
    fields,
  }: { verb?: unknown; title?: unknown; submit_label?: unknown; fields?: unknown } = $props();

  const card = $derived(parseCard(JSON.stringify({ kind: 'form', verb, title, submit_label, fields })));
  const cart = useCart();
</script>

{#if cart && card && card.kind === 'form'}
  <FormCard {card} />
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
