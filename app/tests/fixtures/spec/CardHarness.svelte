<!-- Test harness: renders a pawbar-card fence body the way the bar's thread does, with a cart store and the thread context provided. Created 2026-09-27 for the spec card tests. -->
<script lang="ts">
  import CardBlock from '../../../src/components/cards/CardBlock.svelte';
  import { provideCart, type CartStore } from '../../../src/store/cart.svelte';
  import { provideBarThread } from '../../../src/components/cards/thread';

  let { json, cart }: { json: string; cart?: CartStore } = $props();
  // svelte-ignore state_referenced_locally
  if (cart) provideCart(cart);
  provideBarThread();
</script>

<CardBlock {json} />
