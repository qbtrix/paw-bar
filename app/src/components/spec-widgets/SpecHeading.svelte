<!--
  SpecHeading.svelte — the `heading` widget: a short title inside a generated
  block. Created 2026-09-27. `level` 2, 3 or 4 (default 3) sets the element;
  the size stays modest because the block sits inside a chat reply.
-->
<script lang="ts">
  import { asString, oneOf } from './props';

  let {
    content,
    level,
    class: className,
    style,
  }: { content?: unknown; level?: unknown; class?: string; style?: string } = $props();

  const tag = $derived(`h${oneOf(String(level ?? ''), ['2', '3', '4'], '3')}`);
</script>

<svelte:element this={tag} class={['spec-heading', className]} {style}>{asString(content, 200)}</svelte:element>

<style>
  .spec-heading {
    margin: 0;
    font-size: 1.05em;
    font-weight: 650;
    line-height: 1.3;
  }
</style>
