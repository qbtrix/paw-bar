<!-- ConversationView.svelte — one conversation: identity header, thread, composer.
     Created 2026-08-19 (Messenger).

     Split out of GlassShell's panel body so the tabbed surface has something to
     push onto and pop off of. The transcript and composer are the EXISTING
     MessageList component, unchanged — this is the frame around
     them, not a reimplementation.

     The header states who is answering and that a human can take over. That
     second line is not decoration: it is the difference between a visitor who
     waits for a person and one who gives up on a bot, and it is the single
     most load-bearing sentence on the surface.

     The back affordance always goes to the Messages list rather than to
     "wherever you came from". A back button whose destination depends on route
     history is the thing that makes people stop trusting back buttons.

     2026-08-19: the cart badge (and with it the checkout handoff) is back in
     this header — see CartBadge's own note for what orphaned it.

     2026-08-19: the composer LEFT this component. It lives in the shell's
     docked bar below the panel now, so it is the same input in the same place
     whichever surface is showing — which is what the comp draws, and what
     stops the widget owning two different text boxes depending on where the
     visitor happens to be standing. -->
<script lang="ts">
  import CartBadge from './CartBadge.svelte';
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
    menuOpen = false,
    footer,
    menu,
    expanded = false,
    onback,
    onclose,
    onmenu,
    onexpand,
  }: {
    store: ChatStore;
    agentName: string;
    agentAvatar: string;
    subtitle: string;
    greeting: string;
    menuOpen?: boolean;
    footer?: Snippet;
    menu?: Snippet;
    expanded?: boolean;
    onback: () => void;
    onclose: () => void;
    onmenu: () => void;
    onexpand: () => void;
  } = $props();

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
      <!-- The cart follows the visitor between the tab surface and a thread:
           an action loop that loses its checkout when they open a conversation
           is the same dead end as having no checkout at all. -->
      <CartBadge />
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
      <!-- A long answer with cards is still cramped in a 520px column, so
           the reading surface can grow. Opt-in and reversible — which is the
           difference between this and opening as a modal in the first place. -->
      <button
        type="button"
        class="icon-btn"
        onclick={onexpand}
        aria-label={expanded ? 'Shrink conversation' : 'Expand conversation'}
        aria-pressed={expanded}
      >
        <Icon name={expanded ? 'shrink' : 'expand'} />
      </button>
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
    background: var(--pawbar-wash-strong);
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

</style>
