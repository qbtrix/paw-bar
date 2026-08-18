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

     The tabs mount lazily and stay mounted once visited. Mounting all three up
     front costs three fetches on open for surfaces the visitor may never look
     at; unmounting on leave throws away scroll position and a half-typed
     search. Keeping what has been seen is the behaviour that matches how people
     actually use these. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Article } from '../lib/articles-client';
  import type { VisitorConversation } from '../lib/conversations-client';
  import type { ChatStore } from '../store/chat.svelte';
  import ConversationView from './ConversationView.svelte';
  import HelpTab from './tabs/HelpTab.svelte';
  import HomeTab from './tabs/HomeTab.svelte';
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
  } = $props();

  // Once a tab has been opened it stays mounted (see the header note).
  let seen = $state<Set<MessengerTab>>(new Set(['home']));
  let seed = $state('');
  let conversationView: ReturnType<typeof ConversationView> | null = $state(null);

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
   *  starting sentence. */
  function ask(text = '') {
    seed = text;
    inConversation = true;
    queueMicrotask(() => conversationView?.focus());
  }

  function openExisting(id: string) {
    seed = '';
    onopenConversation(id);
    inConversation = true;
  }

  function startNew() {
    seed = '';
    onnewConversation();
    inConversation = true;
    queueMicrotask(() => conversationView?.focus());
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
    <div class="pane">
      <ConversationView
        bind:this={conversationView}
        {store}
        {agentName}
        {agentAvatar}
        subtitle={agentSubtitle}
        {greeting}
        {seed}
        {menuOpen}
        {footer}
        {menu}
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
    <div class="pane">
      <!-- Each tab is kept in the DOM once seen and hidden with `hidden`, which
           also removes it from the accessibility tree and from tab order — a
           visually hidden panel that still takes focus is worse than one that
           re-renders. -->
      <div class="tabpane" hidden={tab !== 'home'}>
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
        <div class="tabpane" hidden={tab !== 'messages'}>
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
        <div class="tabpane" hidden={tab !== 'help'}>
          <HelpTab
            {articles}
            loading={articlesLoading}
            onarticle={onarticle}
            onask={(text) => ask(text ?? '')}
          />
        </div>
      {/if}
    </div>

    <TabBar {tabs} active={tab} onselect={select} />
  {/if}
</div>

<style>
  .messenger {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
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
  }

  .tabpane[hidden] {
    display: none;
  }
</style>
