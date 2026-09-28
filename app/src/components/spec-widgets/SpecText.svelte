<!--
  SpecText.svelte — the `text` widget: one run of plain text. Created
  2026-09-27; the same day its props moved to Ripple's standard slim atom
  (`text: string`), so a bar spec is also a valid Ripple spec. Text only,
  always a text binding.
-->
<script lang="ts">
  import { asString } from './props';

  let {
    text,
    class: className,
    style,
  }: { text?: unknown; class?: string; style?: string } = $props();
</script>

<p class={['spec-text', className]} {style}>{asString(text)}</p>

<style>
  .spec-text {
    margin: 0;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
</style>
