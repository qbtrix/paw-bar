<!--
  Markdown.svelte — Renders parsed segments (sanitized HTML runs + code fences +
  action cards + the streaming shimmer). Created 2026-07-15 (A3 glass bar). The
  ONLY {@html} in this app is segment.html, which is DOMPurify-sanitized inside
  renderMarkdown() against the pinned ALLOWED_TAGS allowlist (see lib/markdown.ts
  + the drift-guard test). Everything else is a text binding.

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
