<!--
  MessageRow.svelte — One chat turn. Created 2026-07-15 (A3 glass bar). User
  turns render as a plain text bubble (textContent, never innerHTML). Assistant
  turns render streamed markdown through Markdown.svelte and carry a footer:
  copy, a thumbs rate, and a provenance line ("grounded in this site's
  knowledge") — the provenance sells the no-hallucination trust story. The
  footer only shows once the turn is done (not mid-stream) and never on errors.
  2026-07-30 (sources on replies): when the reply carries sanitized source
  citations, a "Sources ›" toggle sits beside the provenance badge and expands
  to link chips (new tab, noopener). Titles bind as TEXT; hrefs are pre-vetted
  http(s) urls (lib/sources gates both the SSE frame and the restored row).
-->
<script lang="ts">
  import type { Message } from '../store/chat.svelte';
  import Markdown from './Markdown.svelte';

  let { message }: { message: Message } = $props();

  let copied = $state(false);
  let rating = $state<'up' | 'down' | null>(null);
  let sourcesOpen = $state(false);

  const isAssistant = $derived(message.role === 'assistant');
  const showFooter = $derived(isAssistant && message.status === 'done' && message.content.length > 0);
  const sources = $derived(showFooter && message.sources ? message.sources : []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      copied = true;
      setTimeout(() => (copied = false), 1400);
    } catch {
      /* clipboard blocked — leave idle */
    }
  }
  function rate(value: 'up' | 'down') {
    rating = rating === value ? null : value;
  }
</script>

<div class="row" class:user={!isAssistant} class:assistant={isAssistant}>
  <div class="bubble">
    {#if isAssistant}
      {#if message.content}
        <Markdown content={message.content} streaming={message.status === 'streaming'} />
      {:else if message.status === 'streaming'}
        <div class="typing" aria-label="Assistant is typing">
          <span></span><span></span><span></span>
        </div>
      {/if}
      {#if message.status === 'error'}
        <div class="err" role="status">Something went wrong. Try asking again.</div>
      {/if}
    {:else}
      <p class="text">{message.content}</p>
    {/if}
  </div>

  {#if showFooter}
    <div class="footer">
      <span class="provenance">Grounded in this site's knowledge</span>
      {#if sources.length > 0}
        <button
          type="button"
          class="sources-toggle"
          class:open={sourcesOpen}
          onclick={() => (sourcesOpen = !sourcesOpen)}
          aria-expanded={sourcesOpen}
          aria-label={sourcesOpen ? 'Hide sources' : 'Show sources'}
        >
          <span>Sources</span>
          <!-- lucide chevron-right, rotates when open -->
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      {/if}
      <div class="actions">
        <button type="button" onclick={copy} aria-label="Copy reply">{copied ? 'Copied' : 'Copy'}</button>
        <button
          type="button"
          class:active={rating === 'up'}
          onclick={() => rate('up')}
          aria-label="Helpful"
          aria-pressed={rating === 'up'}>Yes</button>
        <button
          type="button"
          class:active={rating === 'down'}
          onclick={() => rate('down')}
          aria-label="Not helpful"
          aria-pressed={rating === 'down'}>No</button>
      </div>
    </div>
    {#if sourcesOpen && sources.length > 0}
      <div class="source-chips">
        {#each sources as source (source.url)}
          <a class="source-chip" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .row {
    display: flex;
    flex-direction: column;
    gap: 5px;
    max-width: 100%;
  }
  .row.user {
    align-items: flex-end;
  }
  .row.assistant {
    align-items: flex-start;
  }
  .bubble {
    /* 88% of the narrow corner box was fine; on the wide centered palette an
       unbounded 88% makes unreadable ~800px lines — cap for measure. */
    max-width: min(88%, 640px);
    padding: 10px 13px;
    border-radius: 16px;
    border: 1px solid var(--pawbar-border);
  }
  .row.user .bubble {
    background: var(--pawbar-user-bubble);
    color: var(--pawbar-accent-fg);
    border-color: transparent;
    border-bottom-right-radius: 6px;
  }
  .row.assistant .bubble {
    background: var(--pawbar-assistant-bubble);
    border-bottom-left-radius: 6px;
  }
  .text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 14px;
    line-height: 1.5;
  }
  .err {
    margin-top: 6px;
    font-size: 12px;
    color: var(--pawbar-danger);
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 4px;
    flex-wrap: wrap;
  }
  .provenance {
    font-size: 11px;
    color: var(--pawbar-fg-muted);
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .provenance::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--pawbar-accent);
  }
  .sources-toggle {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font: inherit;
    font-size: 11px;
    color: var(--pawbar-fg-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 7px;
    border-radius: 7px;
  }
  .sources-toggle svg {
    transition: transform 0.15s ease;
  }
  .sources-toggle.open svg {
    transform: rotate(90deg);
  }
  .sources-toggle:hover,
  .sources-toggle.open {
    color: var(--pawbar-fg);
    background: color-mix(in oklab, var(--pawbar-fg) 8%, transparent);
  }
  .source-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0 4px;
    max-width: min(88%, 640px);
  }
  .source-chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--pawbar-border);
    background: color-mix(in oklab, var(--pawbar-fg) 5%, transparent);
    color: var(--pawbar-fg-muted);
    font-size: 11px;
    line-height: 1.4;
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .source-chip:hover {
    color: var(--pawbar-fg);
    border-color: color-mix(in oklab, var(--pawbar-fg) 25%, transparent);
  }
  .actions {
    display: flex;
    gap: 4px;
  }
  .actions button {
    font: inherit;
    font-size: 11px;
    color: var(--pawbar-fg-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 7px;
    border-radius: 7px;
  }
  .actions button:hover {
    color: var(--pawbar-fg);
    background: color-mix(in oklab, var(--pawbar-fg) 8%, transparent);
  }
  .actions button.active {
    color: var(--pawbar-accent);
    background: color-mix(in oklab, var(--pawbar-accent) 16%, transparent);
  }
  .typing {
    display: inline-flex;
    gap: 4px;
    padding: 3px 0;
  }
  .typing span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--pawbar-fg-muted);
    animation: pawbar-typing 1.2s infinite ease-in-out;
  }
  .typing span:nth-child(2) { animation-delay: 0.15s; }
  .typing span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes pawbar-typing {
    0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
    30% { opacity: 1; transform: translateY(-3px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .typing span { animation: none; }
  }
</style>
