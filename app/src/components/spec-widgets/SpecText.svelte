<!--
  SpecText.svelte — the `text` widget of the Paw Bar spec manifest: one run of
  plain text. Created 2026-09-27. `tone: "muted"` uses the thread's muted ink.
  Text only, always a text binding.
-->
<script lang="ts">
  import { asString } from './props';

  let {
    content,
    tone,
    class: className,
    style,
  }: { content?: unknown; tone?: unknown; class?: string; style?: string } = $props();
</script>

<p class={['spec-text', tone === 'muted' && 'muted', className]} {style}>{asString(content)}</p>

<style>
  .spec-text {
    margin: 0;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }
</style>
