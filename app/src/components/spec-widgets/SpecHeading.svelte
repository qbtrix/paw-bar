<!--
  SpecHeading.svelte — the `heading` widget: a short title inside a generated
  block. Created 2026-09-27; props follow Ripple's standard slim atom
  (`text`, `level` 2-4, default 3). The size stays modest because the block
  sits inside a chat reply.
-->
<script lang="ts">
  import { asString, oneOf } from './props';

  let {
    text,
    level,
    class: className,
    style,
  }: { text?: unknown; level?: unknown; class?: string; style?: string } = $props();

  const tag = $derived(`h${oneOf(String(level ?? ''), ['2', '3', '4'], '3')}`);
</script>

<svelte:element this={tag} class={['spec-heading', className]} {style}>{asString(text, 200)}</svelte:element>

<style>
  .spec-heading {
    margin: 0;
    font-size: 1.05em;
    font-weight: 650;
    line-height: 1.3;
  }
</style>
