<!-- ConversationView.svelte — one conversation: identity header, thread, composer.
     Created 2026-08-19 (Messenger).

     Split out of GlassShell's panel body so the tabbed surface has something to
     push onto and pop off of. The transcript and composer are the EXISTING
     MessageList / Composer components, unchanged — this is the frame around
     them, not a reimplementation.

     The header states who is answering and that a human can take over. That
     second line is not decoration: it is the difference between a visitor who
     waits for a person and one who gives up on a bot, and it is the single
     most load-bearing sentence on the surface.

     The back affordance always goes to the Messages list rather than to
     "wherever you came from". A back button whose destination depends on route
     history is the thing that makes people stop trusting back buttons. -->
<script lang="ts">
  import Composer from './Composer.svelte';
  import Icon from './Icon.svelte';
  import MessageList from './MessageList.svelte';
  import type { Snippet } from 'svelte';
  import type { ChatStore } from '../store/chat.svelte';

  let {
    store,
    agentName,
    agentAvatar,
    subtitle,
    greeting,
    seed = '',
    menuOpen = false,
    footer,
    menu,
    onback,
    onclose,
    onmenu,
  }: {
    store: ChatStore;
    agentName: string;
    agentAvatar: string;
    subtitle: string;
    greeting: string;
    /** Prefills the composer — a Home starter or a Help query the visitor gave
     *  up on. Handed over rather than sent, so they can still edit it. */
    seed?: string;
    menuOpen?: boolean;
    footer?: Snippet;
    menu?: Snippet;
    onback: () => void;
    onclose: () => void;
    onmenu: () => void;
  } = $props();

  let composer: ReturnType<typeof Composer> | null = $state(null);

  export function focus() {
    composer?.focus();
  }

  export function prefill(text: string) {
    composer?.prefill(text);
  }

  $effect(() => {
    if (seed) composer?.prefill(seed);
  });
</script>

<div class="conversation">
  <header class="head">
    <button type="button" class="icon-btn" onclick={onback} aria-label="Back to messages">
      <Icon name="back" />
    </button>

    <div class="identity">
      {#if agentAvatar}
        <img class="avatar" src={agentAvatar} alt="" loading="lazy" decoding="async" />
      {:else}
        <span class="avatar avatar-fallback" aria-hidden="true"><Icon name="chat" /></span>
      {/if}
      <span class="identity-copy">
        <span class="identity-name">{agentName}</span>
        <span class="identity-sub">{subtitle}</span>
      </span>
    </div>

    <div class="head-actions">
      <div class="menu-wrap">
        <button
          type="button"
          class="icon-btn"
          onclick={onmenu}
          aria-label="Conversation options"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <Icon name="more" />
        </button>
        {#if menu}{@render menu()}{/if}
      </div>
      <button type="button" class="icon-btn" onclick={onclose} aria-label="Close concierge">
        <Icon name="close" />
      </button>
    </div>
  </header>

  <!-- The owner's greeting when they set one, our own copy when they did not.
       Passing `greeting` straight through overrode MessageList's default with an
       empty string, so a site that never wrote a greeting opened to a blank
       thread — the one moment the surface most needs to say something. -->
  <MessageList
    messages={store.messages}
    greeting={greeting || 'Ask anything about this site — the team can step in any time.'}
    {footer}
  />

  {#if store.error}
    <p class="error" role="status">{store.error}</p>
  {/if}

  {#if store.botPaused}
    <p class="notice" role="status">
      <span class="notice-dot"></span>
      <span>You're chatting with the team</span>
    </p>
  {/if}

  <div class="composer-well">
    <Composer
      bind:this={composer}
      isStreaming={store.isStreaming}
      placeholder="Ask a question…"
      onSend={(text) => store.send(text)}
      onStop={() => store.stop()}
    />
  </div>
</div>

<style>
  .conversation {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    padding: 10px 10px 10px 6px;
    border-bottom: 1px solid var(--pawbar-border);
  }

  .identity {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    flex: 1;
  }

  .avatar {
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 50%;
    object-fit: cover;
  }

  .avatar-fallback {
    display: grid;
    place-items: center;
    background: var(--pawbar-surface-raised);
    color: var(--pawbar-fg-muted);
    font-size: 15px;
  }

  .identity-copy {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .identity-name {
    font-size: 13.5px;
    font-weight: 650;
    letter-spacing: -0.005em;
    color: var(--pawbar-fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .identity-sub {
    font-size: 11.5px;
    color: var(--pawbar-fg-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }

  .menu-wrap {
    position: relative;
  }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--pawbar-fg-muted);
    font-size: 18px;
    cursor: pointer;
    transition:
      background var(--pawbar-duration-fast) var(--pawbar-ease),
      color var(--pawbar-duration-fast) var(--pawbar-ease);
  }

  .icon-btn:hover {
    background: oklch(1 0 0 / 0.08);
    color: var(--pawbar-fg);
  }

  .icon-btn:focus-visible {
    outline: 2px solid var(--pawbar-ring);
    outline-offset: -2px;
  }

  .error,
  .notice {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: none;
    margin: 0;
    padding: 8px 16px;
    font-size: 12px;
    line-height: 1.4;
  }

  .error {
    color: var(--pawbar-danger);
  }

  .notice {
    color: var(--pawbar-fg-muted);
  }

  .notice-dot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: var(--pawbar-accent);
  }

  .composer-well {
    flex: none;
    padding: 0 12px 12px;
  }
</style>
