<!-- MessagesTab.svelte — the visitor's own conversations.
     Created 2026-08-19 (Messenger).

     This tab is the reason the backend needed conversation identity at all. It
     could not have been built before: a visitor owned exactly one conversation
     per widget, permanently, so there was never a list.

     The "Ask a question" pill floats over the list rather than sitting at the
     end of it, because the primary action must be reachable without scrolling
     past however many conversations the visitor has accumulated.

     Three states worth naming, all of which happen in the first week of a real
     install: loading (first paint only), empty (nobody has ever written), and
     a list. The empty state does not apologise or explain the feature — it
     offers the action, which is the only thing the visitor wants from it. -->
<script lang="ts">
  import Icon from '../Icon.svelte';
  import type { VisitorConversation } from '../../lib/conversations-client';

  let {
    conversations,
    loading,
    agentName,
    agentAvatar,
    onopen,
    onask,
  }: {
    conversations: VisitorConversation[];
    loading: boolean;
    agentName: string;
    agentAvatar: string;
    onopen: (id: string) => void;
    onask: () => void;
  } = $props();

  // A relative timestamp that never re-renders is wrong within a minute of the
  // panel opening, and this panel stays open while the visitor waits for a
  // reply — precisely the window where "now" turning into "3m" is the thing
  // they are watching for. One interval for the whole list; cleared on unmount.
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(id);
  });

  /** Compact relative age, matching what a messenger shows in a list row.
   *  Anything older than a week reads as a date — "8d" stops being useful at
   *  the point where the visitor would rather know when. */
  function ago(iso: string, at: number): string {
    if (!iso) return '';
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '';
    const mins = Math.floor((at - then) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
</script>

<div class="messages">
  <div class="scroll">
    {#if loading}
      <ul class="list" aria-busy="true" aria-label="Loading conversations">
        {#each [0, 1, 2] as row (row)}
          <li class="skeleton-row">
            <span class="skeleton avatar"></span>
            <span class="skeleton-lines">
              <span class="skeleton line short"></span>
              <span class="skeleton line"></span>
            </span>
          </li>
        {/each}
      </ul>
    {:else if conversations.length === 0}
      <div class="empty">
        <p class="empty-title">No messages yet</p>
        <p class="empty-copy">Ask us anything — we usually reply in a few minutes.</p>
      </div>
    {:else}
      <ul class="list">
        {#each conversations as conversation (conversation.id)}
          <li>
            <button type="button" class="row" onclick={() => onopen(conversation.id)}>
              {#if agentAvatar}
                <img class="avatar" src={agentAvatar} alt="" loading="lazy" decoding="async" />
              {:else}
                <span class="avatar avatar-fallback" aria-hidden="true">
                  <Icon name="chat" />
                </span>
              {/if}
              <span class="row-body">
                <span class="row-head">
                  <span class="row-name">{agentName}</span>
                  <span class="row-time">{ago(conversation.lastMessageAt, now)}</span>
                </span>
                <span class="row-preview">
                  {conversation.preview || 'No messages yet'}
                </span>
              </span>
              {#if conversation.active}
                <!-- Says which conversation a new message would join. Without it
                     a visitor with several threads has no way to tell, and the
                     composer's behaviour looks arbitrary. -->
                <span class="live" title="In progress">
                  <span class="live-dot"></span>
                  <span class="sr-only">In progress</span>
                </span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="pill-well">
    <button type="button" class="pill" onclick={onask}>
      <span>Ask a question</span>
      <Icon name="send" />
    </button>
  </div>
</div>

<style>
  .messages {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* Room for the floating pill, so the last row is never trapped under it. */
    padding: 8px 8px 76px;
  }

  .list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    width: 100%;
    padding: 12px;
    border: 0;
    border-radius: var(--pawbar-radius-sm);
    background: transparent;
    color: var(--pawbar-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--pawbar-duration-fast) var(--pawbar-ease);
  }

  .row:hover {
    background: var(--pawbar-wash);
  }

  .row:focus-visible {
    outline: 2px solid var(--pawbar-ring);
    outline-offset: -2px;
  }

  .avatar {
    width: 36px;
    height: 36px;
    flex: none;
    border-radius: 50%;
    object-fit: cover;
  }

  .avatar-fallback {
    display: grid;
    place-items: center;
    background: var(--pawbar-surface-raised);
    color: var(--pawbar-fg-muted);
    font-size: 18px;
  }

  .row-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }

  .row-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .row-name {
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: -0.005em;
  }

  .row-time {
    flex: none;
    font-size: 11.5px;
    color: var(--pawbar-fg-subtle);
    font-variant-numeric: tabular-nums;
  }

  .row-preview {
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--pawbar-fg-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .live {
    flex: none;
    align-self: center;
  }

  .live-dot {
    display: block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--pawbar-accent);
  }

  .empty {
    display: flex;
    /* Centred in the pane rather than pinned to its top: an empty state stranded
       under the header with a screen of nothing below it reads as a surface that
       failed to load, not as one with nothing in it yet. */
    min-height: 100%;
    justify-content: center;
    flex-direction: column;
    gap: 5px;
    align-items: center;
    text-align: center;
    padding: 52px 28px;
  }

  .empty-title {
    margin: 0;
    font-size: 14.5px;
    font-weight: 600;
    color: var(--pawbar-fg);
  }

  .empty-copy {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--pawbar-fg-muted);
    max-width: 30ch;
  }

  /* Floats over the list so the primary action never scrolls away. */
  .pill-well {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: center;
    padding: 14px;
    pointer-events: none;
    background: linear-gradient(to top, var(--pawbar-surface-strong) 35%, transparent);
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    pointer-events: auto;
    padding: 11px 18px;
    border: 0;
    border-radius: 999px;
    background: var(--pawbar-accent);
    color: var(--pawbar-accent-fg);
    font: inherit;
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: -0.005em;
    cursor: pointer;
    transition: transform var(--pawbar-duration-fast) var(--pawbar-ease);
  }

  .pill:hover {
    transform: translateY(calc(-1px * var(--pawbar-motion-scale)));
  }

  .pill:focus-visible {
    outline: 2px solid var(--pawbar-ring);
    outline-offset: 3px;
  }

  .skeleton-row {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 12px;
  }

  .skeleton-lines {
    display: flex;
    flex-direction: column;
    gap: 7px;
    flex: 1;
  }

  .skeleton {
    display: block;
    background: var(--pawbar-wash-strong);
    border-radius: 6px;
    animation: pulse 1.6s var(--pawbar-ease) infinite;
  }

  .skeleton.avatar {
    border-radius: 50%;
  }

  .line {
    height: 9px;
  }

  .line.short {
    width: 38%;
  }

  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }

  /* A pulsing skeleton is exactly the kind of ambient motion this setting is
     asking us to stop; the shape still communicates "loading". */
  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
    }
  }

</style>
