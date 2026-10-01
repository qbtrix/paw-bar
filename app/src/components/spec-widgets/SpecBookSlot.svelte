<!--
  SpecBookSlot.svelte — the `book_slot` widget: book a session in the
  conversation. The model names the slot ids it offers; the server hydrates
  them into `slots` (labels in the visitor's timezone) and the session type
  before the spec reaches the bar. The props go through lib/booking's
  parseBookSlot; a card with no usable slot draws nothing at all, so the reply
  around it still reads naturally. Like the other action widgets it needs the
  cart store's action path, and without one it shows "Card unavailable".
-->
<script lang="ts">
  import BookSlotCard from '../cards/BookSlotCard.svelte';
  import { parseBookSlot } from '../../lib/booking';
  import { useCart } from '../../store/cart.svelte';

  let {
    session_type,
    slots,
    name,
    email,
    notes,
  }: { session_type?: unknown; slots?: unknown; name?: unknown; email?: unknown; notes?: unknown } = $props();

  const card = $derived(parseBookSlot({ session_type, slots, name, email, notes }));
  const cart = useCart();
</script>

{#if card && !cart}
  <p class="spec-unavailable">Card unavailable</p>
{:else if card}
  <BookSlotCard {card} />
{/if}

<style>
  .spec-unavailable {
    margin: 0;
    font-size: 12.5px;
    font-style: italic;
    color: var(--pawbar-thread-muted, var(--pawbar-fg-muted));
  }
</style>
