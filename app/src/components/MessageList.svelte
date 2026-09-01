<!--
  MessageList.svelte — Scrolling transcript. Created 2026-07-15 (A3 glass bar).
  Renders a MessageRow per turn and pins to the bottom as content streams in.
  2026-07-30 (email capture): optional `footer` snippet rendered inside the
  scroller after the rows — the shell uses it for the inline contact prompt so
  the bubble lives IN the thread, not pinned under it.

  2026-08-19 (follow fix): auto-follow now reads the reader's INTENT from their
  scroll events instead of re-measuring geometry after every DOM update. The old
  check ran inside the effect, i.e. once the new content was already laid out,
  so `scrollHeight - scrollTop - clientHeight < 80` was not asking "is the
  reader near the bottom" — it was asking "was that delta shorter than 80px".
  One code block, table, or long bubble answered no, and the transcript stopped
  following for the rest of the reply while the visitor watched a stationary
  screen. Intent only changes when the READER scrolls, which is the only event
  that should ever change it.

  2026-08-19 (live region): the scroller is a role="log", so a reply streaming
  in is announced rather than silently appearing. aria-relevant="additions"
  keeps it to new turns — without it every token of a streamed edit re-announces
  the whole thread.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Message } from '../store/chat.svelte';
  import MessageRow from './MessageRow.svelte';

  let { messages, greeting = "Hi — ask me anything about this site.", footer }: {
    messages: Message[];
    greeting?: string;
    footer?: Snippet;
  } = $props();

  let scroller: HTMLDivElement | null = $state(null);

  // Reader intent. True until they scroll away from the tail, and true again the
  // moment they come back to it. Plain `let`, not $state: nothing renders from
  // it, and making it reactive would re-run the effect below on every scroll.
  let following = true;

  /** Their own scrolling is the ONLY thing that decides this. Measured here,
   *  where the layout is settled and no delta has just landed. The threshold is
   *  slack for sub-pixel scroll positions and momentum overscroll, not a guess
   *  about how much content arrived. */
  function onScroll() {
    if (!scroller) return;
    following = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
  }

  $effect(() => {
    // Touch the streaming content so this re-runs as deltas arrive.
    const tail = messages.length > 0 ? messages[messages.length - 1].content : '';
    void tail;
    if (!scroller || !following) return;
    queueMicrotask(() => {
      if (scroller && following) scroller.scrollTop = scroller.scrollHeight;
    });
  });
</script>

<div
  class="list"
  bind:this={scroller}
  onscroll={onScroll}
  role="log"
  aria-live="polite"
  aria-relevant="additions"
  aria-label="Conversation"
>
  {#if messages.length === 0}
    <div class="greeting">{greeting}</div>
  {:else}
    {#each messages as message (message.id)}
      <!-- One malformed turn costs one turn. Before this, a render-time throw
           anywhere in the thread (a repeated citation key was the real case)
           propagated to the mount root and took the whole widget down on
           somebody else's site. -->
      <svelte:boundary>
        <MessageRow {message} />
        {#snippet failed()}
          <p class="row-failed" role="status">This message couldn't be displayed.</p>
        {/snippet}
      </svelte:boundary>
    {/each}
    {#if footer}{@render footer()}{/if}
  {/if}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 18px 16px 20px;
    flex: 1;
    min-height: 0;
    /* A READING COLUMN, not a full-bleed row. In the 520px panel this resolves
       to the plain 16px gutter and nothing changes. Expanded to a 1280px
       viewport it centres the turns instead of throwing the visitor's bubble
       against the right edge and the answer against the left — half a metre
       apart, which is not a conversation, it is two columns of unrelated text.
       Capping the bubbles alone (they stop at 640px) never fixed that: the cap
       controls line length, and this controls where the lines sit. */
    padding-inline: max(16px, calc((100% - var(--pawbar-read-col)) / 2));
  }
  .greeting {
    margin: auto 0;
    text-align: center;
    color: var(--pawbar-fg-muted);
    font-size: 14px;
    line-height: 1.5;
    padding: 24px 12px;
  }
  .row-failed {
    margin: 0;
    align-self: flex-start;
    padding: 10px 14px;
    border-radius: var(--pawbar-radius-sm);
    background: var(--pawbar-assistant-bubble);
    color: var(--pawbar-fg-muted);
    font-size: 13px;
  }
</style>
