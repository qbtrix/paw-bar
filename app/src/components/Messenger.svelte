<!-- Messenger.svelte — the tabbed panel body.
     Created 2026-08-19 (Messenger).

     Owns WHICH surface the panel is showing and nothing else. GlassShell keeps
     the drag protocol, the chip/bar/panel views, the postMessage lifecycle and
     the operator poll — all of it tested and none of it about tabs — and hands
     the panel's interior to this component. Splitting the other way (a new
     shell that re-implements the lifecycle) would have put a hundred lines of
     working, load-bearing behaviour at risk to move a nav bar.

     Navigation is a two-level stack, not a router: a tab, and optionally a
     conversation pushed on top of it. That is the whole model, and it is why
     `back` always has an obvious destination.

     Navigation is ANIMATED as a stack, not cross-faded: the conversation flies
     in from the right and leaves to the right, the tab surface leaves to the
     left and comes back from the left. That direction is the whole reason a
     back button feels like going back — a symmetric fade tells the visitor
     nothing about where they are. Svelte transitions rather than CSS because
     both surfaces are mounting and unmounting; the two layers are absolutely
     positioned so they can overlap mid-flight without the panel's height
     jumping.

     The tabs mount lazily and stay mounted once visited. Mounting all three up
     front costs three fetches on open for surfaces the visitor may never look
     at; unmounting on leave throws away scroll position and a half-typed
     search. Keeping what has been seen is the behaviour that matches how people
     actually use these.

     2026-08-19 (captain direction): the nav moved to the TOP, as segmented
     pills, and it now sits in a real header alongside the panel's own controls.
     Before this the tab surface had NO close affordance at all — the only way
     out of Home/Messages/Help was Escape or the chevron on the bar below, so
     the two halves of the panel disagreed about whether it could be closed.
     The header is the fix for both at once. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { duration, travel, expoOut } from '../lib/motion';
  import type { Article } from '../lib/articles-client';
  import type { VisitorConversation } from '../lib/conversations-client';
  import type { ChatStore } from '../store/chat.svelte';
  import CartBadge from './CartBadge.svelte';
  import ConversationView from './ConversationView.svelte';
  import HelpTab from './tabs/HelpTab.svelte';
  import HomeTab from './tabs/HomeTab.svelte';
  import Icon from './Icon.svelte';
  import MessagesTab from './tabs/MessagesTab.svelte';
  import TabBar, { type Tab } from './TabBar.svelte';

  export type MessengerTab = 'home' | 'messages' | 'help';

  let {
    store,
    tab = $bindable('home'),
    inConversation = $bindable(false),
    conversations,
    conversationsLoading,
    articles,
    articlesLoading,
    greeting,
    starters,
    agentName,
    agentAvatar,
    agentSubtitle,
    avatars,
    unreadCount = 0,
    menuOpen = false,
    footer,
    menu,
    onopenConversation,
    onnewConversation,
    onarticle,
    onclose,
    onmenu,
    onseed,
    expanded = false,
    onexpand,
  }: {
    store: ChatStore;
    tab?: MessengerTab;
    inConversation?: boolean;
    conversations: VisitorConversation[];
    conversationsLoading: boolean;
    articles: Article[];
    articlesLoading: boolean;
    greeting: string;
    starters: string[];
    agentName: string;
    agentAvatar: string;
    agentSubtitle: string;
    avatars: string[];
    unreadCount?: number;
    menuOpen?: boolean;
    footer?: Snippet;
    menu?: Snippet;
    onopenConversation: (id: string) => void;
    onnewConversation: () => void;
    onarticle: (article: Article) => void;
    onclose: () => void;
    onmenu: () => void;
    /** Focus the shell's composer, optionally prefilled. */
    onseed: (text: string) => void;
    expanded?: boolean;
    onexpand: () => void;
  } = $props();

  // Once a tab has been opened it stays mounted (see the header note).
  let seen = $state<Set<MessengerTab>>(new Set(['home']));

  const tabs = $derived<Tab[]>([
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'messages', label: 'Messages', icon: 'messages', badge: unreadCount },
    { id: 'help', label: 'Help', icon: 'help' },
  ]);

  function select(id: string) {
    tab = id as MessengerTab;
    seen = new Set(seen).add(tab);
    // Changing tabs leaves the conversation — the tab bar is the top level, so
    // a thread cannot stay open "underneath" a different section.
    inConversation = false;
  }

  /** Open the conversation in progress, optionally handing the composer a
   *  starting sentence. The composer belongs to the shell now, so the seed is
   *  handed UP rather than pushed into a child — one input, one owner. */
  function ask(text = '') {
    inConversation = true;
    onseed(text);
  }

  function openExisting(id: string) {
    onopenConversation(id);
    inConversation = true;
    onseed('');
  }

  function startNew() {
    onnewConversation();
    ask('');
  }

  export function openConversationView(text = '') {
    seen = new Set(seen).add('messages');
    ask(text);
  }

  export function leaveConversation() {
    inConversation = false;
  }

  /** True when Escape should be absorbed here rather than closing the panel. */
  export function canGoBack(): boolean {
    return inConversation;
  }
</script>

<div class="messenger">
  {#if inConversation}
    <div
      class="layer"
      in:fly={{ x: travel(30), duration: duration(), easing: expoOut }}
      out:fly={{ x: travel(30), duration: duration(0.75), easing: expoOut }}
    >
      <ConversationView
        {store}
        {agentName}
        {agentAvatar}
        subtitle={agentSubtitle}
        {greeting}
        {menuOpen}
        {footer}
        {menu}
        {expanded}
        {onexpand}
        onback={() => {
          inConversation = false;
          tab = 'messages';
          seen = new Set(seen).add('messages');
        }}
        {onclose}
        {onmenu}
      />
    </div>
  {:else}
    <div
      class="layer"
      in:fly={{ x: travel(-30), duration: duration(), easing: expoOut }}
      out:fly={{ x: travel(-30), duration: duration(0.75), easing: expoOut }}
    >
      <header class="head">
        <TabBar {tabs} active={tab} onselect={select} />
        <div class="head-actions">
          <!-- Renders nothing until the visitor has items, so this is a header
               control on a shopping conversation and invisible on every other. -->
          <CartBadge />
          <button
            type="button"
            class="icon-btn"
            onclick={onexpand}
            aria-label={expanded ? 'Shrink concierge' : 'Expand concierge'}
            aria-pressed={expanded}
          >
            <Icon name={expanded ? 'shrink' : 'expand'} />
          </button>
          <button type="button" class="icon-btn" onclick={onclose} aria-label="Close concierge">
            <Icon name="close" />
          </button>
        </div>
      </header>

      <div class="pane">
        <!-- Each tab is kept in the DOM once seen. `inert` rather than
             `hidden`: both remove it from the accessibility tree and from tab
             order, but `hidden` is display:none, which cannot be transitioned —
             so the switch between tabs would be the one movement in the panel
             that simply teleports. `visibility` is folded in on a delay below,
             which is what stops three full surfaces being laid out and
             composited to show one. -->
        <div
          class="tabpane"
          class:active={tab === 'home'}
          inert={tab !== 'home'}
          id="pawbar-pane-home"
          role="tabpanel"
          aria-labelledby="pawbar-pane-tab-home"
        >
          <HomeTab
            {greeting}
            {starters}
            {articles}
            {articlesLoading}
            {avatars}
            onask={(text) => ask(text ?? '')}
            onarticle={onarticle}
          />
        </div>

        {#if seen.has('messages')}
          <div
            class="tabpane"
            class:active={tab === 'messages'}
            inert={tab !== 'messages'}
            id="pawbar-pane-messages"
            role="tabpanel"
            aria-labelledby="pawbar-pane-tab-messages"
          >
            <MessagesTab
              {conversations}
              loading={conversationsLoading}
              {agentName}
              {agentAvatar}
              onopen={openExisting}
              onask={startNew}
            />
          </div>
        {/if}

        {#if seen.has('help')}
          <div
            class="tabpane"
            class:active={tab === 'help'}
            inert={tab !== 'help'}
            id="pawbar-pane-help"
            role="tabpanel"
            aria-labelledby="pawbar-pane-tab-help"
          >
            <HelpTab
              {articles}
              loading={articlesLoading}
              onarticle={onarticle}
              onask={(text) => ask(text ?? '')}
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .messenger {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    /* The outgoing layer travels past the edge; without this it would paint
       over the panel's rounded corner on its way out. */
    overflow: hidden;
  }

  /* One navigation level. Absolute so the incoming and outgoing layers can
     occupy the same space mid-transition instead of stacking and doubling the
     panel's height for a few frames. */
  .layer {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
    padding: 10px 10px 10px 12px;
    border-bottom: 1px solid var(--pawbar-border);
  }

  .head-actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--pawbar-fg-muted);
    font-size: 17px;
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

  .pane {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .tabpane {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    opacity: 0;
    transform: translateY(calc(5px * var(--pawbar-motion-scale)));
    pointer-events: none;
    /* Folded out of the render tree once the fade has finished. `inert` already
       took it out of the a11y tree and the tab order, but an inert pane is
       still laid out and composited — three whole surfaces painted to show
       one. The delay is what keeps it visible for its own fade-out; without it
       the leaving pane would vanish on frame zero. */
    visibility: hidden;
    transition:
      opacity var(--pawbar-duration-fast) var(--pawbar-ease),
      transform var(--pawbar-duration-fast) var(--pawbar-ease),
      visibility 0s linear var(--pawbar-duration-fast);
  }

  .tabpane.active {
    opacity: 1;
    transform: none;
    pointer-events: auto;
    visibility: visible;
    transition:
      opacity var(--pawbar-duration-fast) var(--pawbar-ease),
      transform var(--pawbar-duration-fast) var(--pawbar-ease),
      visibility 0s;
  }
</style>
