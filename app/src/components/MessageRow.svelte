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
  2026-07-30 (human takeover): two more roles. An OWNER turn is a different
  speaker, not a different bot answer — it gets its own accent-tinted bubble
  under a small "Team" avatar line, and deliberately NO grounded/Sources
  footer (that's a bot-answer affordance and would misattribute a human's
  words). A SYSTEM turn is a centered quiet chip, never a bubble. Both bind
  their content as TEXT (never markdown, never {@html}) — server-authored is
  not the same as trusted, and a visitor must never be shown markup.
-->
<script lang="ts">
  import type { Message } from '../store/chat.svelte';
  import Markdown from './Markdown.svelte';

  let { message }: { message: Message } = $props();

  let copied = $state(false);
  let rating = $state<'up' | 'down' | null>(null);
  let sourcesOpen = $state(false);

  const isAssistant = $derived(message.role === 'assistant');
  const isOwner = $derived(message.role === 'owner');
  const isSystem = $derived(message.role === 'system');
  const isUser = $derived(message.role === 'user');
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

{#if isSystem}
  <!-- Quiet in-thread notice ("a member of the team joined", "someone is
       replying"). Centered chip, deliberately not a bubble — nobody said it. -->
  <div class="row system">
    <p class="sys-chip" role="status">{message.content}</p>
  </div>
{:else}
  <div class="row" class:user={isUser} class:assistant={isAssistant} class:owner={isOwner}>
    {#if isOwner}
      <div class="speaker">
        <span class="speaker-avatar" aria-hidden="true">
          <!-- lucide user-round (inlined — no icon dep in the widget) -->
          <svg
            viewBox="0 0 24 24"
            width="11"
            height="11"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="8" r="5" />
            <path d="M20 21a8 8 0 0 0-16 0" />
          </svg>
        </span>
        <span>Team</span>
      </div>
    {/if}
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
{/if}

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
  .row.assistant,
  .row.owner {
    align-items: flex-start;
  }
  .row.system {
    align-items: center;
  }
  /* ── A person joined (owner turns + system notices) ─────────────────────── */
  /* Centered, quiet, no bubble — a notice about the conversation, not a turn
     in it. Wraps cleanly at 375px inside the full-height mobile sheet. */
  .sys-chip {
    margin: 0;
    max-width: min(92%, 420px);
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--pawbar-border);
    background: color-mix(in oklab, var(--pawbar-fg) 4%, transparent);
    color: var(--pawbar-fg-muted);
    font-size: 11.5px;
    line-height: 1.45;
    text-align: center;
    word-break: break-word;
  }
  /* The owner is a DIFFERENT SPEAKER, so they get a name + face, not just
     another left bubble. Circular avatar = the mascot/affordance language. */
  .speaker {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--pawbar-fg-muted);
  }
  .speaker-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1.5px solid color-mix(in oklab, var(--pawbar-accent) 60%, transparent);
    color: var(--pawbar-accent);
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
  /* Accent-tinted with a solid accent edge: unmistakably not the bot's grey
     bubble, and not the visitor's solid accent bubble either. */
  .row.owner .bubble {
    background: var(--pawbar-owner-bubble);
    border-color: color-mix(in oklab, var(--pawbar-accent) 32%, transparent);
    border-left: 2px solid var(--pawbar-accent);
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
