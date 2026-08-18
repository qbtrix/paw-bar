<!--
  GlassShell.svelte — The morph shell for the concierge iframe. Created
  2026-07-15 (A3 glass bar). CLICK + ESCAPE driven and mobile-safe (never
  hover-driven). Frosted glass = translucent tinted surface + backdrop-blur on
  the surface itself (no Tauri vibrancy inside an iframe over an unknown host
  bg). Owns nothing but view state — transcript/streaming lives in the injected
  ChatStore.

  2026-07-15 bar-first (captain direction): the docked resting state is a
  center-bottom INPUT BAR (the product face, per the ai-bar genesis mockups) —
  not a corner pill. Views:
    bar   (default) wide glass input bar, center-bottom; draggable by its grip;
          minimizes to the chip; sending opens the panel with the reply.
    chip  minimized pill at the bar's anchor; click restores the bar.
    panel centered command palette — min(940px,100%) over a dim blurred
          backdrop; Esc / ✕ / outside click return to the bar.
  The docked view persists in frame localStorage. Drag protocol: grip
  pointerdown posts {pawbar:drag,phase:start}; the loader goes full-viewport
  and replies {pawbar:box,x,y,w,h}; the app tracks the pointer (pointer
  capture) and posts {pawbar:drag,phase:end,x,y} for the loader to adopt as
  the new dock anchor. Inbound parent messages are honoured only from
  window.parent AND the configured parentOrigin (mirrors the loader's gate).

  Sizing: a ResizeObserver on the inner .pawbar-content wrapper (NOT the fixed
  inset:0 root — observing the root reflects the iframe's own height back and
  folds the dock, the original "folding" bug) posts {pawbar:resize,h,w}; the
  loader applies it only while docked.

  2026-07-15 (C2 action loop): takes the CartStore and provides it via context to
  descendant card CTAs; the panel header carries the CartBadge (checkout handoff),
  and the docked bar shows a compact count badge (opens the panel) when the cart
  is non-empty. Opening the panel triggers the store's one-shot cart hydrate.

  2026-07-30 (form cards): also provides the ContactStore via context
  (provideContact) so a gated FormCard submit can nudge the email-capture
  prompt after it parks a pending decision.

  2026-07-16 (D4 greeting): takes an optional `greeting` prop (the owner's
  concierge greeting, threaded from readConfig via main.ts). When it's a
  non-empty string the panel's empty-transcript state shows it as the welcome
  message; when blank it keeps the default "Ask about this site" copy.

  2026-07-30 quick actions (Crisp parity): the panel header grew a chevron menu
  next to ✕ — New conversation (store.reset() wipes thread + persisted row),
  Download transcript (serializeTranscript → Blob → a.download, no network),
  Minimize (the EXISTING minimize() → chip, no second state machine). The menu
  closes on Escape (before the panel does), outside pointerdown, and any view
  transition. Same design language: icon-btn trigger, glass surface, inlined
  lucide stroke glyphs.

  2026-07-30 (email capture + articles): after an assistant turn rests, the
  shell asks the ContactStore to check ONCE for a pending decision — pending +
  no stored contact flag renders the inline "Leaving? We can email you when
  the team confirms." bubble at the tail of the thread (MessageList's footer
  snippet), with ✕ dismiss (session-only), inline 422 correction, and a quiet
  sent-confirmation. The email value lives ONLY in the input + request body —
  never the transcript, the chat store, or storage. The quick-actions menu
  also grew "Browse articles": the panel body swaps to a fetched article list
  (spinner → list → "No articles yet"; every failure shows the empty state),
  rows open in a new tab, a back affordance (and Escape, peeled before the
  panel's own) returns to the conversation.

  2026-07-30 (human takeover): a person from the site's team can join the
  conversation. The shell drives the OperatorStore's poll from ONE $effect on
  `view` — the loop runs only while the PANEL is open (the visitor is actually
  watching), and stops on ✕ / Escape / minimize / outside click. While the
  owner has taken over (store.botPaused, set by the poll and by the
  human_replying SSE frame) a quiet "you're chatting with the team" chip sits
  above the composer, so the visitor knows why the instant replies stopped.

  2026-07-30 paw-os design-language pass (captain: match ChatPill, esp. phone):
  the docked bar's accent dot became a circular paw MASCOT avatar (ChatPill's
  .mascot-avatar pattern — paw glyph in a 2px-bordered circle); the bar's inner
  Composer is now variant="bare" so the pill is the ONLY chrome (the boxed
  composer inside the pill bar read as double chrome); ≤640px the drag grip is
  hidden (drag is a desktop affordance), paddings tighten, and the mascot
  shrinks — the loader already caps bar width to the viewport.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { ChatStore, ChatStoreConfig } from '../store/chat.svelte';
  import { type CartStore, provideCart } from '../store/cart.svelte';
  import { type ContactStore, provideContact } from '../store/contact.svelte';
  import type { OperatorStore } from '../store/operator.svelte';
  import type { PawBarPoster } from '../lib/postmessage';
  import { fetchArticles, type Article } from '../lib/articles-client';
  import { serializeTranscript } from '../lib/transcript';
  import Composer from './Composer.svelte';
  import Icon from './Icon.svelte';
  import Messenger, { type MessengerTab } from './Messenger.svelte';
  import type { ConversationsStore } from '../store/conversations.svelte';

  let {
    store,
    cart,
    contact,
    operator,
    conversations,
    chatConfig,
    poster,
    theme = 'dark',
    greeting = '',
    starters = [],
    agentName = 'Concierge',
    agentAvatar = '',
    agentSubtitle = 'The team can also help',
    avatars = [],
    parentOrigin = '',
  }: {
    store: ChatStore;
    cart: CartStore;
    contact: ContactStore;
    operator: OperatorStore;
    conversations: ConversationsStore;
    chatConfig: ChatStoreConfig;
    poster: PawBarPoster;
    theme?: 'light' | 'dark';
    greeting?: string;
    starters?: string[];
    agentName?: string;
    agentAvatar?: string;
    agentSubtitle?: string;
    avatars?: string[];
    parentOrigin?: string;
  } = $props();

  // Expose the cart to descendant card CTAs (Markdown → CardBlock → ProductCard)
  // + the header badge without prop-drilling through the transcript. untrack:
  // the store instance is created once in main.ts and never reassigned, so we
  // capture it at init without registering a reactive dependency.
  provideCart(untrack(() => cart));
  // Same pattern for the contact prompt: a gated FormCard submit parks a
  // pending decision, so the card nudges contact.maybeOffer() (self-guarded)
  // and the email-capture prompt fires naturally.
  provideContact(untrack(() => contact));

  type View = 'bar' | 'chip' | 'panel';
  const VIEW_KEY = '__pawbar_view_v1';

  function readInitialView(): View {
    try {
      return localStorage.getItem(VIEW_KEY) === 'chip' ? 'chip' : 'bar';
    } catch {
      return 'bar';
    }
  }
  function persistDock(v: 'bar' | 'chip') {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage denied in a sandboxed frame — the pref just doesn't stick */
    }
  }

  let view = $state<View>(readInitialView());
  let contentEl: HTMLDivElement | null = $state(null);
  let composer: ReturnType<typeof Composer> | null = $state(null);

  // Announce the persisted dock view ONCE so the loader sizes the first box
  // right. Untracked on purpose: a reactive read of `view` here would re-post a
  // dock view when the panel opens and yank the loader out of fullscreen
  // mid-open (bit the first live run). View transitions post explicitly.
  $effect(() => {
    const dock = untrack(() => view);
    poster.view(dock === 'chip' ? 'chip' : 'bar');
  });

  function openPanel() {
    view = 'panel';
    menuOpen = false;
    poster.open();
    // Initial cart hydrate on the first open (one-shot inside the store).
    void cart.load();
    // The Home tab shows articles and the Messages tab shows conversations, so
    // both load on OPEN rather than on first tab-touch: paying two requests at
    // the moment the visitor is reading the greeting is cheaper than a spinner
    // the first time they tap a tab. Both are one-shot / latched internally.
    loadArticles();
    void conversations.refresh();
  }
  function closePanel() {
    view = 'bar';
    menuOpen = false;
    poster.view('bar');
    persistDock('bar');
    queueMicrotask(() => composer?.focus());
  }
  function minimize() {
    view = 'chip';
    menuOpen = false;
    poster.view('chip');
    persistDock('chip');
  }
  function restoreBar() {
    view = 'bar';
    poster.view('bar');
    persistDock('bar');
    queueMicrotask(() => composer?.focus());
  }

  // Sending from the bar morphs into the panel so the reply streams in place —
  // and lands the visitor IN the conversation, not on the Home tab, because the
  // reply they just asked for is about to stream somewhere they can see it.
  function handleBarSend(text: string) {
    openPanel();
    inConversation = true;
    void store.send(text);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || drag) return;
    // Innermost layer first: the quick-actions menu, then a conversation (back
    // to the list it was opened from), then the panel itself. Escape peeling one
    // layer at a time is what keeps it from feeling like a trapdoor.
    if (menuOpen) {
      menuOpen = false;
      return;
    }
    if (view === 'panel' && inConversation) {
      inConversation = false;
      messengerTab = 'messages';
      return;
    }
    if (view === 'panel') closePanel();
    else if (view === 'bar') minimize();
  }

  // A thread restored from localStorage may predate conversation identity, so it
  // has turns but no id. The moment the list names the conversation in progress,
  // adopt it — otherwise the visitor's next turn is sent with no id, the server
  // resolves one, and the local transcript stays filed under the wrong key.
  // Guarded inside the store: it only ever adopts when it has no id yet.
  $effect(() => {
    const active = conversations.activeId;
    if (active) untrack(() => store.adoptConversation(active));
  });

  // ── Owner messages (poll while the panel is open) ─────────────────────────
  // ONE lifecycle owner: the loop runs exactly while the visitor is looking at
  // the panel. Every close path (✕, Escape, minimize, outside click, the
  // host's pawbar:host-close) already routes through a `view` change, so this
  // effect covers them all — and its teardown stops the loop when the app
  // unmounts. The store itself skips polls while the tab is hidden and latches
  // in-flight requests, so this stays a two-line wiring.
  $effect(() => {
    if (view === 'panel') operator.start();
    else operator.stop();
    return () => operator.stop();
  });

  // ── Email capture (pending-decision contact prompt) ───────────────────────
  // After an assistant turn reaches a rest state, ask the ContactStore to run
  // its ONE pending-decision check (it self-guards on the stored flag, the
  // session dismissal, and in-flight polls). Streaming edge detection only —
  // untracked reads keep message content out of this effect's dependencies.
  let contactEmail = $state('');
  let prevStreaming = false;
  $effect(() => {
    const streaming = store.isStreaming;
    if (prevStreaming && !streaming) {
      const last = untrack(() => store.messages[store.messages.length - 1]);
      if (last?.role === 'assistant' && last.status === 'done') void contact.maybeOffer();
    }
    prevStreaming = streaming;
  });

  function submitContact(e: SubmitEvent) {
    e.preventDefault();
    void contact.submit(contactEmail);
  }

  // ── Messenger surfaces (2026-08-19) ───────────────────────────────────────
  // The panel is a tabbed Messenger now. Articles are a TAB rather than a menu
  // item, so they load once when the panel first opens instead of on a click
  // most visitors never made.
  let messengerTab = $state<MessengerTab>('home');
  let inConversation = $state(false);
  let articles = $state<Article[]>([]);
  let articlesLoading = $state(false);
  let articlesLoaded = false;

  function loadArticles() {
    if (articlesLoaded) return;
    articlesLoaded = true;
    articlesLoading = true;
    void fetchArticles({
      endpoint: chatConfig.endpoint,
      widgetId: chatConfig.widgetId,
      signedKey: chatConfig.siteKey,
    }).then((list) => {
      articles = list;
      articlesLoading = false;
    });
  }

  /** An article opens on the site itself, in a new tab. The widget is a
   *  concierge, not a reader: pulling the page into a 380px panel would show it
   *  worse than the site does and strand the visitor away from its navigation. */
  function openArticle(article: Article) {
    window.open(article.url, '_blank', 'noopener,noreferrer');
  }

  /** Walk into one of the visitor's earlier conversations. */
  function openExistingConversation(id: string) {
    store.switchTo(id);
    conversations.syncActive(id);
  }

  // ── Quick actions (panel header menu) ─────────────────────────────────────
  let menuOpen = $state(false);
  let menuWrapEl: HTMLDivElement | null = $state(null);

  function onWindowPointerDown(e: PointerEvent) {
    if (!menuOpen) return;
    if (menuWrapEl && !menuWrapEl.contains(e.target as Node)) menuOpen = false;
  }

  /** "New conversation" now tells the SERVER, so the next turn genuinely starts
   *  cold. `reset()` is async for that reason; the panel stays interactive while
   *  it lands, and a refused open leaves the visitor in the conversation they
   *  already had rather than in a nameless one. */
  async function newConversation() {
    menuOpen = false;
    await store.reset();
    if (store.conversationId) conversations.syncActive(store.conversationId);
    void conversations.refresh();
  }

  // Client-side only: serialize the thread and hand the visitor a .txt file.
  function downloadTranscript() {
    menuOpen = false;
    const text = serializeTranscript(store.messages);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'conversation.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // ── Drag protocol (bar only) ──────────────────────────────────────────────
  // Pre-drag, pointer coords are iframe-relative and the iframe IS the dock box,
  // so the grab offset equals the pointer position at pointerdown. Once the
  // loader replies with the box (and the iframe is full-viewport), pointer
  // coords are viewport-relative and box.x = clientX - grabX holds the grip
  // under the pointer. DOCK_PAD converts between the iframe box and the visible
  // content inside the root's padding.
  const DOCK_PAD = 12;
  let drag = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let awaitingBox = false;
  let grabX = 0;
  let grabY = 0;

  function onGripDown(e: PointerEvent) {
    // Draggable while DOCKED (bar or minimized chip) — the drag protocol and
    // the fixed-position ghost are view-agnostic; the loader sizes the dock
    // box per view and the anchor is shared, so a chip dropped somewhere
    // restores the bar there too.
    if ((view !== 'bar' && view !== 'chip') || drag || awaitingBox) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    grabX = e.clientX;
    grabY = e.clientY;
    awaitingBox = true;
    poster.dragStart();
  }
  function onGripMove(e: PointerEvent) {
    if (!drag) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    drag = {
      ...drag,
      x: clamp(e.clientX - grabX, 0, Math.max(0, vw - drag.w)),
      y: clamp(e.clientY - grabY, 0, Math.max(0, vh - drag.h)),
    };
  }
  function onGripUp() {
    awaitingBox = false;
    if (!drag) return;
    poster.dragEnd(drag.x, drag.y);
    drag = null;
  }
  function clamp(n: number, lo: number, hi: number): number {
    return n < lo ? lo : n > hi ? hi : n;
  }

  // Inbound messages from the loader: same dual gate as the loader's own
  // listener — the exact configured parent origin AND the parent window itself.
  $effect(() => {
    function onMessage(ev: MessageEvent) {
      if (window.parent === window || ev.source !== window.parent) return;
      if (parentOrigin && ev.origin !== parentOrigin) return;
      const data = ev.data as { type?: string; x?: number; y?: number; w?: number; h?: number } | null;
      if (!data || typeof data !== 'object') return;
      switch (data.type) {
        case 'pawbar:box': {
          if (!awaitingBox) break;
          awaitingBox = false;
          const { x, y, w, h } = data;
          if ([x, y, w, h].every((n) => Number.isFinite(n))) {
            drag = { x: x!, y: y!, w: w!, h: h! };
          }
          break;
        }
        case 'pawbar:host-open':
          if (view !== 'panel') openPanel();
          break;
        case 'pawbar:host-close':
          if (view === 'panel') closePanel();
          break;
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });

  // Report docked content size (+ the root padding) so the loader fits the box.
  const ROOT_PAD = DOCK_PAD * 2;
  $effect(() => {
    if (!contentEl) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      const h = rect?.height ?? contentEl?.offsetHeight ?? 0;
      const w = rect?.width ?? contentEl?.offsetWidth ?? 0;
      poster.resize(h + ROOT_PAD, w + ROOT_PAD);
    });
    ro.observe(contentEl);
    return () => ro.disconnect();
  });
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onWindowPointerDown} />

<!-- Quick actions, rendered into the conversation header's overflow. Kept here
     rather than inside ConversationView because every action it offers is the
     SHELL's to perform: minimize is a dock transition, download reads the
     store, and "new conversation" now has to reach the server. -->
{#snippet quickMenu()}
  {#if menuOpen}
    <div class="menu" role="menu" aria-label="Conversation options" bind:this={menuWrapEl}>
      <button type="button" class="menu-item" role="menuitem" onclick={newConversation}>
        <Icon name="plus" size="14px" />
        <span>New conversation</span>
      </button>
      <button
        type="button"
        class="menu-item"
        role="menuitem"
        onclick={downloadTranscript}
        disabled={store.messages.length === 0}
      >
        <Icon name="send" size="14px" />
        <span>Download transcript</span>
      </button>
      <button type="button" class="menu-item" role="menuitem" onclick={minimize}>
        <Icon name="chevron-down" size="14px" />
        <span>Minimize</span>
      </button>
    </div>
  {/if}
{/snippet}

<!-- Inline contact prompt, rendered at the tail of the thread via MessageList's
     footer snippet. The email value stays in local component state + the
     request body — it never touches the chat store or the transcript. -->
{#snippet contactPrompt()}
  {#if contact.status === 'offer'}
    <div class="contact" role="group" aria-label="Email notification offer">
      <button type="button" class="contact-dismiss" onclick={() => contact.dismiss()} aria-label="Dismiss">
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
        </svg>
      </button>
      <p class="contact-copy">Leaving? We can email you when the team confirms.</p>
      <form class="contact-form" onsubmit={submitContact}>
        <input
          class="contact-input"
          class:invalid={contact.emailError}
          type="email"
          bind:value={contactEmail}
          placeholder="you@example.com"
          autocomplete="email"
          aria-label="Your email"
          aria-invalid={contact.emailError}
        />
        <button type="submit" class="contact-send" disabled={contact.isSubmitting}>Notify me</button>
      </form>
      {#if contact.emailError}
        <p class="contact-err" role="status">That email doesn't look right.</p>
      {/if}
    </div>
  {:else if contact.status === 'sent'}
    <p class="contact-sent" role="status">
      <span class="glow-dot"></span>
      <span>Got it — we'll email you when the team confirms.</span>
    </p>
  {/if}
{/snippet}

<div
  class="pawbar-root"
  data-pawbar-theme={theme}
  data-pawbar-view={view}
  data-pawbar-dragging={drag ? 'true' : undefined}
  role="region"
  aria-label="Site concierge"
>
  {#if view === 'panel'}
    <button type="button" class="backdrop" onclick={closePanel} aria-label="Close concierge" tabindex="-1"></button>
  {/if}

  <div
    class="pawbar-content"
    bind:this={contentEl}
    style={drag
      ? `position:fixed;left:${drag.x + DOCK_PAD}px;top:${drag.y + DOCK_PAD}px;width:${drag.w - ROOT_PAD}px;height:${drag.h - ROOT_PAD}px;`
      : ''}
  >
    {#if view === 'chip'}
      <div class="chip-row">
        <button
          type="button"
          class="grip chip-grip"
          aria-label="Move concierge chip"
          onpointerdown={onGripDown}
          onpointermove={onGripMove}
          onpointerup={onGripUp}
          onpointercancel={onGripUp}
        >
          <svg viewBox="0 0 10 16" width="8" height="13" aria-hidden="true">
            <circle cx="3" cy="3" r="1.3" fill="currentColor" />
            <circle cx="3" cy="8" r="1.3" fill="currentColor" />
            <circle cx="3" cy="13" r="1.3" fill="currentColor" />
            <circle cx="7" cy="3" r="1.3" fill="currentColor" />
            <circle cx="7" cy="8" r="1.3" fill="currentColor" />
            <circle cx="7" cy="13" r="1.3" fill="currentColor" />
          </svg>
        </button>
        <button type="button" class="chip" onclick={restoreBar} aria-expanded="false" aria-label="Open concierge bar">
          <span class="glow-dot"></span>
          <span>Ask</span>
        </button>
      </div>
    {:else if view === 'bar'}
      <div class="bar">
        <button
          type="button"
          class="grip"
          aria-label="Move concierge bar"
          onpointerdown={onGripDown}
          onpointermove={onGripMove}
          onpointerup={onGripUp}
          onpointercancel={onGripUp}
        >
          <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
            <circle cx="3" cy="3" r="1.3" fill="currentColor" />
            <circle cx="3" cy="8" r="1.3" fill="currentColor" />
            <circle cx="3" cy="13" r="1.3" fill="currentColor" />
            <circle cx="7" cy="3" r="1.3" fill="currentColor" />
            <circle cx="7" cy="8" r="1.3" fill="currentColor" />
            <circle cx="7" cy="13" r="1.3" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          class="mascot"
          onclick={openPanel}
          aria-label="Open conversation"
          title="Open conversation"
        >
          <!-- lucide paw-print glyph (inlined — no icon dep in the widget) -->
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="4" r="2" />
            <circle cx="18" cy="8" r="2" />
            <circle cx="20" cy="16" r="2" />
            <path
              d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"
            />
          </svg>
        </button>
        <div class="bar-composer">
          <Composer
            bind:this={composer}
            isStreaming={store.isStreaming}
            variant="bare"
            onSend={handleBarSend}
            onStop={() => store.stop()}
          />
        </div>
        {#if cart.count > 0}
          <button
            type="button"
            class="bar-cart"
            onclick={openPanel}
            aria-label={`Cart, ${cart.count} item${cart.count === 1 ? '' : 's'} — open concierge`}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M6 6h15l-1.5 9h-12L5 3H2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <circle cx="9" cy="20" r="1.4" fill="currentColor" />
              <circle cx="17" cy="20" r="1.4" fill="currentColor" />
            </svg>
            <span>{cart.count}</span>
          </button>
        {/if}
        <button type="button" class="icon-btn" onclick={minimize} aria-label="Minimize">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M5 12h14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    {:else}
      <section class="panel" role="dialog" aria-modal="true" aria-label="Site concierge">
        <Messenger
          bind:tab={messengerTab}
          bind:inConversation
          {store}
          conversations={conversations.items}
          conversationsLoading={conversations.loading}
          {articles}
          {articlesLoading}
          {greeting}
          {starters}
          {agentName}
          {agentAvatar}
          {agentSubtitle}
          {avatars}
          {menuOpen}
          footer={contactPrompt}
          menu={quickMenu}
          onopenConversation={openExistingConversation}
          onnewConversation={newConversation}
          onarticle={openArticle}
          onclose={closePanel}
          onmenu={() => (menuOpen = !menuOpen)}
        />
      </section>
    {/if}
  </div>
</div>

<style>
  .pawbar-root {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: stretch;
    padding: 12px;
    font-family: var(--pawbar-font);
    color: var(--pawbar-fg);
    /* The root spans the whole iframe but is transparent chrome — only the
       backdrop and content wrapper below should catch clicks. */
    pointer-events: none;
  }
  /* Open = centered command palette (the loader makes the iframe full-viewport). */
  .pawbar-root[data-pawbar-view='panel'] {
    justify-content: center;
    align-items: center;
    padding: clamp(16px, 4vh, 40px);
  }
  /* Mid-drag the content wrapper is fixed-positioned inline; kill the padding
     so the wrapper's coords map 1:1 to the posted box. */
  .pawbar-root[data-pawbar-dragging='true'] {
    padding: 0;
  }

  /* Outside-click catcher + page dim. A real button (keyboard story stays Esc /
     the header X; tabindex -1 keeps it out of the tab order). */
  .backdrop {
    position: absolute;
    inset: 0;
    border: none;
    padding: 0;
    background: oklch(0.13 0.01 260 / 0.34);
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
    pointer-events: auto;
    cursor: default;
  }

  /* The measured content box: bar, chip, or panel. Kept separate from
     .pawbar-root so the ResizeObserver reads real content size, not the fixed
     root's iframe size. Re-enables pointer events the root switched off. */
  .pawbar-content {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    min-height: 0;
    max-height: 100%;
  }
  /* The chip hugs its content so the reported width shrinks the iframe box. */
  .pawbar-root[data-pawbar-view='chip'] .pawbar-content {
    align-self: center;
    width: fit-content;
  }
  /* Palette proportions from the genesis mockup (~969×737 on a 16" frame). */
  .pawbar-root[data-pawbar-view='panel'] .pawbar-content {
    position: relative;
    width: min(940px, 100%);
    height: min(720px, 100%);
  }

  /* ── Shared accent dot ──────────────────────────────────────────────────── */
  .glow-dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--pawbar-accent);
    box-shadow: 0 0 10px var(--pawbar-accent);
  }

  /* ── Docked input bar (the product face) ────────────────────────────────── */
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px 8px 4px;
    border-radius: 999px;
    border: 1px solid var(--pawbar-border);
    background: var(--pawbar-surface);
    -webkit-backdrop-filter: blur(var(--pawbar-blur)) saturate(1.5);
    backdrop-filter: blur(var(--pawbar-blur)) saturate(1.5);
    /* Inset top highlight = the light edge that sells frosted glass. */
    box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.1), var(--pawbar-shadow);
  }
  .bar-composer {
    flex: 1;
    min-width: 0;
  }
  /* Circular paw mascot — ChatPill's .mascot-avatar language, bar-sized.
     A BUTTON: clicking it opens the panel (the returning visitor's way back
     into a restored conversation — Intercom's launcher affordance). */
  .mascot {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid color-mix(in oklab, var(--pawbar-fg) 55%, transparent);
    background: none;
    color: color-mix(in oklab, var(--pawbar-fg) 72%, transparent);
    box-shadow: 0 2px 8px oklch(0 0 0 / 0.25);
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  .mascot:hover {
    color: var(--pawbar-fg);
    border-color: color-mix(in oklab, var(--pawbar-fg) 75%, transparent);
  }
  /* The bar IS the composer chrome — strip the inner composer's own shell. */
  .bar-composer :global(form) {
    border: none;
    background: none;
    padding: 0;
  }
  .bar-composer :global(form:focus-within) {
    box-shadow: none;
  }
  .grip {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 34px;
    border: none;
    border-radius: 10px;
    background: none;
    color: var(--pawbar-fg-muted);
    cursor: grab;
    touch-action: none;
  }
  .grip:active {
    cursor: grabbing;
    color: var(--pawbar-fg);
  }
  /* Compact cart indicator on the docked bar — count only, opens the panel
     (where the full CartBadge popover + checkout lives). Shown only when the
     visitor has items. */
  .bar-cart {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--pawbar-border);
    border-radius: 999px;
    background: none;
    color: var(--pawbar-fg);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .bar-cart:hover {
    background: color-mix(in oklab, var(--pawbar-fg) 8%, transparent);
  }

  /* ── Minimized chip ─────────────────────────────────────────────────────── */
  .chip-row {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .chip-grip {
    width: 18px;
    height: 30px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 11px 16px;
    border-radius: 999px;
    border: 1px solid var(--pawbar-border);
    background: var(--pawbar-surface);
    -webkit-backdrop-filter: blur(var(--pawbar-blur)) saturate(1.5);
    backdrop-filter: blur(var(--pawbar-blur)) saturate(1.5);
    box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.1), var(--pawbar-shadow);
    color: var(--pawbar-fg);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: transform 0.16s ease;
  }
  .chip:hover {
    transform: translateY(-1px);
  }

  /* ── Panel (frosted surface) ────────────────────────────────────────────── */
  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    max-height: 100%;
    height: 100%;
    border-radius: var(--pawbar-radius);
    border: 1px solid var(--pawbar-border);
    background: var(--pawbar-surface);
    -webkit-backdrop-filter: blur(var(--pawbar-blur)) saturate(1.6);
    backdrop-filter: blur(var(--pawbar-blur)) saturate(1.6);
    box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.09), var(--pawbar-shadow);
    overflow: hidden;
  }

  /* ── Empty transcript welcome ───────────────────────────────────────────── */
  /* Owner greeting: a sentence or two in the owner's voice, so it reads as
     body copy (relaxed weight/leading), not a terse bold title. */
  .icon-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 8px;
    background: none;
    color: var(--pawbar-fg-muted);
    cursor: pointer;
  }
  .icon-btn:hover {
    color: var(--pawbar-fg);
    background: color-mix(in oklab, var(--pawbar-fg) 8%, transparent);
  }
  /* ── Quick actions menu (header) ────────────────────────────────────────── */
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    min-width: 190px;
    padding: 5px;
    border-radius: 12px;
    border: 1px solid var(--pawbar-border);
    background: var(--pawbar-surface-strong);
    -webkit-backdrop-filter: blur(var(--pawbar-blur)) saturate(1.5);
    backdrop-filter: blur(var(--pawbar-blur)) saturate(1.5);
    box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.08), var(--pawbar-shadow);
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 9px;
    border: none;
    border-radius: 8px;
    background: none;
    color: var(--pawbar-fg);
    font: inherit;
    font-size: 13px;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .menu-item:hover:not(:disabled) {
    background: color-mix(in oklab, var(--pawbar-fg) 8%, transparent);
  }
  .menu-item:disabled {
    color: var(--pawbar-fg-muted);
    opacity: 0.6;
    cursor: default;
  }
  /* ── Inline contact prompt (email capture, in-thread) ───────────────────── */
  .contact {
    position: relative;
    align-self: flex-start;
    max-width: min(88%, 420px);
    padding: 12px 14px;
    border-radius: 16px;
    border-bottom-left-radius: 6px;
    border: 1px solid var(--pawbar-border);
    background: var(--pawbar-assistant-bubble);
  }
  .contact-dismiss {
    position: absolute;
    top: 6px;
    right: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--pawbar-fg-muted);
    cursor: pointer;
  }
  .contact-dismiss:hover {
    color: var(--pawbar-fg);
    background: color-mix(in oklab, var(--pawbar-fg) 8%, transparent);
  }
  .contact-copy {
    margin: 0 18px 9px 0;
    font-size: 13px;
    line-height: 1.45;
  }
  .contact-form {
    display: flex;
    gap: 6px;
  }
  .contact-input {
    flex: 1;
    min-width: 0;
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid var(--pawbar-border);
    background: color-mix(in oklab, var(--pawbar-fg) 4%, transparent);
    color: var(--pawbar-fg);
    font: inherit;
    font-size: 13px;
  }
  .contact-input::placeholder {
    color: var(--pawbar-fg-muted);
  }
  .contact-input:focus {
    outline: none;
    border-color: color-mix(in oklab, var(--pawbar-accent) 55%, transparent);
  }
  .contact-input.invalid {
    border-color: color-mix(in oklab, var(--pawbar-danger) 55%, transparent);
  }
  .contact-send {
    flex: none;
    padding: 7px 13px;
    border: none;
    border-radius: 999px;
    background: var(--pawbar-accent);
    color: var(--pawbar-accent-fg);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .contact-send:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .contact-err {
    margin: 7px 0 0;
    font-size: 12px;
    color: var(--pawbar-danger);
  }
  .contact-sent {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    align-self: flex-start;
    margin: 0;
    padding: 0 4px;
    font-size: 12px;
    color: var(--pawbar-fg-muted);
  }
  .contact-sent .glow-dot {
    width: 6px;
    height: 6px;
    box-shadow: 0 0 8px var(--pawbar-accent);
  }

  /* ── Articles view (panel body swap) ────────────────────────────────────── */
  @keyframes pawbar-dots {
    0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
    30% { opacity: 1; transform: translateY(-3px); }
  }
  @media (prefers-reduced-motion: reduce) {
  }
  /* Bot-paused state: quiet, persistent, and out of the way — it sits above
     the composer rather than in the thread so it can't be scrolled past. */
  /* Phone: the pill face tightens like ChatPill's mobile pass (smaller
     mascot, hidden BAR grip, tighter gaps). Lives at the END of the sheet so
     it wins the same-specificity cascade against the component base rules.
     CAUTION — the media query sees the IFRAME's width, not the device's: the
     bar iframe is ~viewport-wide so ≤640px really means "phone" there, but
     the CHIP iframe shrinks to content (~100px) and matches ALWAYS. Hiding a
     bare `.grip` here removed the chip's drag handle on every desktop (the
     captain's 2026-07-30 report), so the hide is scoped to the bar's grip. */
  @media (max-width: 640px) {
    .bar {
      gap: 6px;
      padding: 6px 8px;
    }
    .bar .grip {
      display: none;
    }
    .mascot {
      width: 26px;
      height: 26px;
      border-width: 1.5px;
    }
    .contact {
      max-width: 100%;
    }
  }
</style>
