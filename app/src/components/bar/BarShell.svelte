<!--
  BarShell.svelte — the new Paw Bar as the widget: the stores, consent, and the
  loader protocol around one PawBarFrame. Created 2026-09-27.

  The frame is data in, events out. This file is the "in" and the "out":

  • Stores. ChatStore reads the saved transcript and mints the visitor's id
    when it is built, so it (and the OperatorStore that polls on top of it) is
    built only once chatting is allowed. Cart, contact and conversations touch
    nothing until they are used, so they exist from the start (the frame hands
    cart and contact to the reply cards once, when it mounts).
  • Consent. `config.consentRequired` plus no saved yes means the frame asks
    first (consent 'required') and nothing above is built. Accept saves the
    yes, builds the stores, then flips consent, and the frame sends the
    message it was holding. "Not now" builds nothing.
  • The operator poll runs fast while the bar is pinned and slow while it is
    closed (only while a person is in the conversation; see OperatorStore).
    The conversation list refreshes on pin and after a reply settles, and the
    store adopts the server's active id when its own is missing.
  • The loader speaks the protocol the deployed loader already knows
    (lib/postmessage), so this runs under an old loader too:
      – view 'chip' once at boot. The chip is the loader's one view that
        honours both reported dimensions and adds no scrim, which is exactly a
        content-sized box. 'bar' (fixed 384 wide) and 'open' (a column plus a
        scrim over the page) are never sent.
      – resize(w, h) from a ResizeObserver on the frame's wrapper, plus the
        root's gutter, via lib/dock-size. Skipped while full screen, where the
        box is the viewport and a report would become the chip's size.
      – expand(on) for full screen; overlay(on) while the card is open, so a
        click on the host page comes back as host-pointerdown and folds the
        bar like any outside click; nothing is posted per host click at rest.
      – host-open pins (and re-asserts the chip: an old loader's
        PawBar.open() switches itself to its column); host-close is ✕.
      – `side` rides on resize for the icon launcher. An old loader ignores it
        and centres the launcher; a new one docks it in its corner.
      – pawbar:viewport (new loader) is the host page's viewport. Until it
        arrives, or forever under an old loader, the screen's available size
        stands in. Never this window's: this window is the iframe, sized from
        the content, and sizing content against it is a feedback loop.
  • The agent's conversation starters (config.starters) are not shown
    (captain, 2026-09-27); the bar has no chips for them.
  • The stage sets a system font for the bar to inherit: in the iframe there
    is no site font, so every word would fall to Times.
  • It owns the iframe document's reset (no margin, transparent background).
    The old shell's glass.css did that before; it was removed 2026-09-27.
  • Layout: a fixed, bottom-anchored stage in the transparent iframe, aligned
    to the launcher's corner. The wrapper never shrinks to the stage (flex:
    none), so a box that lags the content for a frame clips it rather than
    reflowing it into a smaller measurement.

  2026-09-27 (old shell removed): comments no longer describe glass.css as
  sharing this bundle; it and the old shell are deleted.
  2026-09-27 (CR-7, page context): pawbar:page (new loader, posted at frame
  load) is the host page's {url, title}. It goes to lib/host-page, which
  re-strips the query and hash, and chat-client sends it as `page` on every
  chat request. An old loader never posts it, and the field is then omitted.
-->
<script lang="ts" module>
  import type { ChatStore } from '../../store/chat.svelte';
  import type { OperatorStore } from '../../store/operator.svelte';

  /** The two stores that may only exist once chatting is allowed. */
  export interface ChatStores {
    chat: ChatStore;
    operator: OperatorStore;
  }

  export const CONSENT_KEY = '__pawbar_consent_v1:';
  /** The root's gutter on each side. Room for focus rings; the bar has no shadow. */
  export const STAGE_PAD = 8;
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import PawBarFrame, { type BarConsent } from './PawBarFrame.svelte';
  import type { PawBarConfig } from '../../config';
  import type { PawBarPoster } from '../../lib/postmessage';
  import type { CartStore } from '../../store/cart.svelte';
  import type { ContactStore } from '../../store/contact.svelte';
  import type { ConversationsStore } from '../../store/conversations.svelte';
  import { resolveScheme } from '../../lib/scheme';
  import { dockSize } from '../../lib/dock-size';
  import { setHostPage } from '../../lib/host-page';

  let {
    config,
    poster,
    cart,
    contact,
    conversations,
    createChat,
  }: {
    config: PawBarConfig;
    poster: PawBarPoster;
    cart: CartStore;
    contact: ContactStore;
    conversations: ConversationsStore;
    /** Builds the chat and operator stores. Called once, when chatting is allowed. */
    createChat: () => ChatStores;
  } = $props();

  // ── Consent and the stores ────────────────────────────────────────────────
  const consentKey = untrack(() => CONSENT_KEY + config.widgetId);
  function savedConsent(): boolean {
    try {
      return localStorage.getItem(consentKey) === '1';
    } catch {
      return false;
    }
  }
  let consent = $state<BarConsent>(untrack(() => (config.consentRequired && !savedConsent() ? 'required' : 'granted')));
  let stores = $state.raw<ChatStores | null>(untrack(() => (consent === 'granted' ? createChat() : null)));
  function onconsent(granted: boolean) {
    if (!granted || stores) return;
    try {
      localStorage.setItem(consentKey, '1');
    } catch {
      /* blocked storage: the yes lasts for this page only */
    }
    // Stores first: the frame sends its held message the moment consent flips.
    stores = createChat();
    consent = 'granted';
    void conversations.refresh();
  }
  const chat = $derived(stores?.chat ?? null);

  // ── Sending and the rest of the frame's events ───────────────────────────
  async function onsend(text: string) {
    if (!chat) return { ok: false as const, restoreDraft: text };
    const res = await chat.send(text);
    if (res.ok) void conversations.refresh();
    return res.ok ? res : { ok: false as const, restoreDraft: res.restoreDraft };
  }
  function onopenconversation(id: string) {
    chat?.switchTo(id);
    conversations.syncActive(id);
  }
  async function onnewconversation() {
    if (!chat) return;
    await chat.reset();
    if (chat.conversationId) conversations.syncActive(chat.conversationId);
    void conversations.refresh();
  }

  // A thread restored before conversations had ids adopts the server's.
  $effect(() => {
    const active = conversations.activeId;
    if (active && chat) untrack(() => chat.adoptConversation(active));
  });

  // ── Open state, polls, and the loader ─────────────────────────────────────
  let expanded = $state(false);
  let fullscreen = $state(false);
  let cardOpen = $state(false);
  const pinned = $derived(expanded || fullscreen);

  $effect(() => {
    const op = stores?.operator;
    if (!op) return;
    if (pinned) op.start();
    else op.startClosed();
    return () => op.stop();
  });
  $effect(() => {
    if (pinned && stores) void untrack(() => conversations.refresh());
  });

  // The chip is the content-sized box. Once, at boot.
  untrack(() => poster.view('chip'));
  $effect(() => {
    poster.expand(fullscreen);
  });
  // Declared, never left on: while it is off a click on the site sends nothing.
  $effect(() => {
    poster.overlay(cardOpen);
  });

  // ── Host viewport ─────────────────────────────────────────────────────────
  function screenViewport() {
    const s = typeof screen === 'undefined' ? null : screen;
    return { w: s?.availWidth || 1280, h: s?.availHeight || 800 };
  }
  let hostViewport = $state(screenViewport());

  // ── Scheme ────────────────────────────────────────────────────────────────
  let hostScheme = $state(untrack(() => config.hostScheme));
  let prefersDark = $state(typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  const scheme = $derived(resolveScheme({ owner: config.scheme, host: hostScheme, prefersDark }));

  // ── Messages from the loader ──────────────────────────────────────────────
  let frame: ReturnType<typeof PawBarFrame> | undefined = $state();
  $effect(() => {
    const parentOrigin = untrack(() => config.parentOrigin);
    function onMessage(ev: MessageEvent) {
      if (window.parent === window || ev.source !== window.parent) return;
      if (parentOrigin && ev.origin !== parentOrigin) return;
      const data = ev.data as { type?: string; s?: unknown; w?: unknown; h?: unknown } | null;
      if (!data || typeof data !== 'object') return;
      switch (data.type) {
        case 'pawbar:host-open':
          // An old loader's PawBar.open() has just switched itself to its
          // column (with a scrim); put it back on the chip.
          poster.view('chip');
          expanded = true;
          break;
        case 'pawbar:host-close':
          frame?.closeChat();
          break;
        case 'pawbar:host-pointerdown':
          frame?.outsidePress();
          break;
        case 'pawbar:scheme':
          if (data.s === 'l' || data.s === 'd') hostScheme = data.s;
          break;
        case 'pawbar:page':
          setHostPage(data);
          break;
        case 'pawbar:viewport': {
          const w = Number(data.w);
          const h = Number(data.h);
          if (w > 0 && h > 0) hostViewport = { w, h };
          break;
        }
      }
    }
    window.addEventListener('message', onMessage);
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const onScheme = (e: MediaQueryListEvent) => (prefersDark = e.matches);
    mq?.addEventListener?.('change', onScheme);
    return () => {
      window.removeEventListener('message', onMessage);
      mq?.removeEventListener?.('change', onScheme);
    };
  });

  // ── Size reports ──────────────────────────────────────────────────────────
  let stageEl: HTMLDivElement | null = $state(null);
  $effect(() => {
    const stage = stageEl;
    const wrap = stage?.querySelector<HTMLElement>('.frame-wrap');
    if (!wrap) return;
    const side = untrack(() => (config.launcher === 'icon' ? config.side : undefined));
    const report = () => {
      if (fullscreen) return;
      const r = wrap.getBoundingClientRect();
      const { w, h } = dockSize(
        { rect: { width: r.width, height: r.height }, scrollWidth: wrap.scrollWidth, scrollHeight: wrap.scrollHeight },
        STAGE_PAD * 2,
      );
      poster.resize(h, w, side);
    };
    const ro = new ResizeObserver(report);
    ro.observe(wrap);
    report();
    return () => ro.disconnect();
  });
</script>

<div class="stage" data-anchor={config.launcher === 'icon' ? config.side : 'center'} bind:this={stageEl}>
  <PawBarFrame
    bind:this={frame}
    bind:expanded
    bind:fullscreen
    messages={chat?.messages ?? []}
    conversationId={chat?.conversationId ?? ''}
    conversations={stores ? conversations.items : []}
    restoring={!!chat?.hydrating && (chat?.messages.length ?? 0) === 0}
    botPaused={chat?.botPaused ?? false}
    notice={chat?.notice ?? null}
    unavailable={chat?.unavailable ? { contactable: chat.unavailable.contactable } : null}
    cooldownUntil={chat?.cooldownUntil ?? null}
    queueFull={chat?.queueFull ?? false}
    handoff={chat?.handoff ?? 'none'}
    {onsend}
    onstop={() => chat?.stop()}
    onretry={(id) => void chat?.retry(id)}
    onrequesthuman={chat ? (req) => chat.requestHuman(req) : undefined}
    onopenconversation={chat ? onopenconversation : undefined}
    onnewconversation={chat ? onnewconversation : undefined}
    onopenchange={(o) => (cardOpen = o)}
    {cart}
    {contact}
    {consent}
    {onconsent}
    {hostViewport}
    {scheme}
    persistKey={config.widgetId}
    placeholder={config.launcherLabel || undefined}
    greeting={config.greeting}
    logoSrc={config.logo}
    launcher={config.launcher}
    side={config.side}
    size={config.barSize}
    theme={config.barTheme}
    tokens={config.tokens}
    tokensDark={config.tokensDark}
    radius={config.radius}
    disclosure={config.disclosure}
    privacyHref={config.privacyHref}
  />
</div>

<style>
  /* The iframe document is see-through; only the bar paints. */
  :global(html),
  :global(body) {
    margin: 0;
    background: transparent;
  }
  /* The iframe's whole viewport, with the bar sitting on its bottom edge. */
  .stage {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 8px;
    box-sizing: border-box;
    /* The bar inherits its font, which on a plain page is the site's. In the
       iframe there is no site font to inherit, so it would fall to Times. */
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #1c1c21;
  }
  .stage[data-anchor='left'] {
    justify-content: flex-start;
  }
  .stage[data-anchor='right'] {
    justify-content: flex-end;
  }
  /* Never shrink to a box that is a frame behind: clip, and keep measuring
     the true size. */
  .stage > :global(.frame-wrap) {
    flex: none;
  }
</style>
