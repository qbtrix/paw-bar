<!--
  MdInline.svelte — draws Inline nodes (lib/md/types.ts). Created 2026-09-27
  with the native markdown renderer.

  Text is always a text binding; nothing here builds HTML. Every link opens in
  a new tab with noopener + noreferrer, whatever the reply said: the frame sits
  on a customer's page, and a reply must never navigate that page or load
  inside the widget. An href dropped by lib/md/links.ts renders as an <a> with
  no href, as DOMPurify used to leave it.

  The markup is written on one line per node on purpose: whitespace between
  tags would become text between words.
-->
<script lang="ts">
  import Self from './MdInline.svelte';
  import type { Inline } from '../../lib/md/types';

  let { nodes }: { nodes: Inline[] } = $props();
</script>

{#each nodes as n}{#if n.t === 'text'}{n.v}{:else if n.t === 'br'}<br />{:else if n.t === 'code'}<code>{n.v}</code>{:else if n.t === 'link'}<a href={n.href ?? undefined} target="_blank" rel="noopener noreferrer"><Self nodes={n.c} /></a>{:else if n.t === 'strong'}<strong><Self nodes={n.c} /></strong>{:else if n.t === 'em'}<em><Self nodes={n.c} /></em>{:else if n.t === 'del'}<del><Self nodes={n.c} /></del>{:else if n.t === 'sup'}<sup><Self nodes={n.c} /></sup>{:else if n.t === 'sub'}<sub><Self nodes={n.c} /></sub>{/if}{/each}
