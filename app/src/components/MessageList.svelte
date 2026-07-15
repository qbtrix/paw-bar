<!--
  MessageList.svelte — Scrolling transcript. Created 2026-07-15 (A3 glass bar).
  Renders a MessageRow per turn and pins to the bottom as content streams in
  (only auto-scrolls when the user is already near the bottom, so reading
  scroll-back isn't yanked away). Shows a quiet greeting when empty.
-->
<script lang="ts">
  import type { Message } from '../store/chat.svelte';
  import MessageRow from './MessageRow.svelte';

  let { messages, greeting = "Hi — ask me anything about this site." }: {
    messages: Message[];
    greeting?: string;
  } = $props();

  let scroller: HTMLDivElement | null = $state(null);

  // Auto-stick to bottom while streaming, unless the reader scrolled up.
  $effect(() => {
    // Touch the streaming content so this re-runs as deltas arrive.
    const tail = messages.length > 0 ? messages[messages.length - 1].content : '';
    void tail;
    if (!scroller) return;
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    if (nearBottom) {
      queueMicrotask(() => {
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
    }
  });
</script>

<div class="list" bind:this={scroller}>
  {#if messages.length === 0}
    <div class="greeting">{greeting}</div>
  {:else}
    {#each messages as message (message.id)}
      <MessageRow {message} />
    {/each}
  {/if}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow-y: auto;
    padding: 16px;
    flex: 1;
    min-height: 0;
  }
  .greeting {
    margin: auto 0;
    text-align: center;
    color: var(--pawbar-fg-muted);
    font-size: 14px;
    line-height: 1.5;
    padding: 24px 12px;
  }
</style>
