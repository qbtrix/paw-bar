<!-- Test harness: renders a pawbar-card fence body with a cart store, the way the bar's thread does (thread context provided) or, with thread={false}, the way a card outside the thread does (ProductCard). -->
<script lang="ts">
  import CardBlock from '../../../src/components/cards/CardBlock.svelte';
  import { provideCart, type CartStore } from '../../../src/store/cart.svelte';
  import { provideBarThread } from '../../../src/components/cards/thread';

  let { json, cart, thread = true }: { json: string; cart?: CartStore; thread?: boolean } = $props();
  // svelte-ignore state_referenced_locally
  if (cart) provideCart(cart);
  // svelte-ignore state_referenced_locally
  if (thread) provideBarThread();
</script>

<CardBlock {json} />
