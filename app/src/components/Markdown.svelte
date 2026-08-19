<!--
  Markdown.svelte — Renders parsed segments (sanitized HTML runs + code fences +
  action cards + the streaming shimmer). Created 2026-07-15 (A3 glass bar). The
  ONLY {@html} in this app is segment.html, which is DOMPurify-sanitized inside
  renderMarkdown() against the pinned ALLOWED_TAGS allowlist (see lib/markdown.ts
  + the drift-guard test). Everything else is a text binding.

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

  2026-07-15 (C2): a `card` segment carries a raw ``pawbar-card`` JSON string.
  CardBlock validates it and renders native glass components via Svelte props
  only — no HTML injection, the DOMPurify path is untouched. A malformed /
  truncated card or an unknown kind renders a quiet "card unavailable" line
  (handled inside CardBlock), never raw JSON.
-->
<script lang="ts">
  import { parseSegments } from '../lib/markdown';
  import CodeBlock from './CodeBlock.svelte';
  import CardBlock from './cards/CardBlock.svelte';

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
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- segment.html is DOMPurify-sanitized by renderMarkdown() with a strict ALLOWED_TAGS allowlist -->
      {@html segment.html}
    {/if}
  {/each}
</div>
