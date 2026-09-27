<!--
  Markdown.svelte — Renders parsed segments (markdown runs + code fences +
  action cards + the streaming shimmer). Created 2026-07-15 (A3 glass bar).
  2026-09-27 (native renderer): markdown runs are a parsed tree drawn by
  components/md/ with text bindings. This file used to hold the app's only
  {@html} (DOMPurify-sanitized marked output); it has none now, and
  tests/no-html-injection.spec.ts keeps the whole app that way.

  MEASURED 2026-08-19, because "every delta re-parses the whole message, so it
  is quadratic in reply length" is true on paper and was carried as an open
  worry: streaming a 7,332-character reply (roughly six times a real concierge
  answer, with a table, a fenced block and a card) held p50 5ms / p95 7.7ms /
  p99 10.6ms per frame, ONE frame over 16ms and none over 50ms — and the mean
  frame cost in the last quarter of the stream (5.1ms) matched the first
  (5.0ms). The growth is there; it is nowhere near the frame budget, so parsing
  only the trailing block would be complexity bought for nothing. Measured on a
  desktop: a low-end phone is several times slower, so the headroom is smaller
  there, not absent. Re-measure before believing otherwise.

  RE-MEASURED 2026-09-27 for the native renderer, with the same 7,332-character
  shape, one update per 20 characters (366 updates), in jsdom, old and new in
  the same run: old marked + DOMPurify + innerHTML p50 22.8ms / p99 60.9ms,
  growing from 7.3ms (first quarter) to 45.3ms (last); native p50 1.7ms /
  p99 8.2ms, flat (2.0ms → 2.3ms). Parsing is ~0.7ms of that; the rest is
  Svelte, which only touches the block that changed because lib/markdown.ts
  interns unchanged blocks. Without interning the native path was ~8x SLOWER
  than the old one (p50 181ms), so keep it. jsdom numbers compare the two
  paths; they are not browser frame times.

  2026-07-15 (C2): a `card` segment carries a raw ``pawbar-card`` JSON string.
  CardBlock validates it and renders native glass components via Svelte props
  only — no HTML injection. A malformed /
  truncated card or an unknown kind renders a quiet "card unavailable" line
  (handled inside CardBlock), never raw JSON.
-->
<script lang="ts">
  import { parseSegments } from '../lib/markdown';
  import CodeBlock from './CodeBlock.svelte';
  import CardBlock from './cards/CardBlock.svelte';
  import MdBlocks from './md/MdBlocks.svelte';

  let { content, streaming = false }: { content: string; streaming?: boolean } = $props();
  const segments = $derived(parseSegments(content, streaming));
</script>

<div class="pawbar-md">
  {#each segments as segment, i (i)}
    {#if segment.type === 'code'}
      <CodeBlock code={segment.code} lang={segment.lang} />
    {:else if segment.type === 'card'}
      <CardBlock json={segment.json} />
    {:else if segment.type === 'code-loading'}
      <div class="pawbar-shimmer" aria-label="Loading…">
        <div class="pawbar-shimmer-bar"></div>
        <div class="pawbar-shimmer-bar medium"></div>
        <div class="pawbar-shimmer-bar short"></div>
      </div>
    {:else}
      <MdBlocks blocks={segment.blocks} />
    {/if}
  {/each}
</div>
