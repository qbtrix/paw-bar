<!--
  BarShell.svelte — the Paw Bar as the widget: the stores, consent, and the
  loader protocol around one PawBarFrame.

  The frame is data in, events out. This file is the "in" and the "out":

  • Stores. ChatStore reads the saved transcript and mints the visitor's id
    when it is built, so it (and the OperatorStore that polls on top of it) is
    built only once chatting is allowed. Cart, contact and conversations touch
    nothing until they are used, so they exist from the start (the frame hands
    cart and contact to the reply cards once, when it mounts).
  • Consent. `config.consentRequired` plus no saved yes means the frame asks
    first (consent 'required') and nothing above is built. Accept saves the
    yes, builds the stores, then flips consent, and the frame sends the
    message it was holding. "Not now" builds nothing. In the owner preview a
    live consentRequired change shows or clears the step (nothing is saved).
  • The operator poll runs fast while the bar is pinned and slow while it is
    closed (only while a person is in the conversation; see OperatorStore).
    The conversation list refreshes on pin and after a reply settles, and the
    store adopts the server's active id when its own is missing.
  • Every message from the loader passes lib/from-loader: the real parent
    window at the exact boot parentOrigin. No pinned origin, no messages.
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
      – `side` rides on resize to dock the icon launcher (old loaders centre).
      – pawbar:viewport (new loader) is the host page's viewport. Until it
        arrives, or forever under an old loader, the screen's available size
        stands in. Never this window's: this window is the iframe, sized from
        the content, and sizing content against it is a feedback loop. The
        owner preview is the exception: no loader runs there, and the window
        IS the page (a fixed box the dashboard sizes), so it is measured.
  • Owner settings from the config (launcher, side, size, tokens, tokensDark,
    logo, label, disclosure, privacy link, `voice` for the dictation mic,
    `poweredBy` for the credit, `expandable` for the full-screen toggle) go
    straight through to the frame. `config` may be live state (main.ts): the
    owner preview rewrites it, and the frame follows.
  • The site theme (lib/site-theme): the website's own look, under the owner's
    tokens. It starts from the loader's `#t=` fragment (config.siteTheme) and
    is replaced by each {pawbar:site-theme} from the loader, through the same
    loader gate as everything else. In the owner preview it comes instead from
    the scene iframe (iframe.pawbar-scene, the site running the loader in
    `?pawbar=sniff` mode, sandboxed so its origin is 'null'): accepted only
    when ev.source is that iframe's contentWindow, and asked for once at boot
    with {pawbar:sniff} in case it already ran. Every theme is validated by
    readSiteTheme. The site's Google Fonts sheet is linked into this document
    unless the owner set --pawbar-font.
    The preview posts each theme up to the dashboard as {pawbar:site-theme,
    theme} (null when empty), targeted at exactly parentOrigin, and null once
    when nothing arrived within 2s of boot.
  • The owner preview's state switcher: {pawbar:preview-state, state} through
    the loader gate, preview only. 'rest' unpins and leaves full screen,
    'open' pins an empty thread (greeting, consent step), 'thread' pins
    SAMPLE_THREAD. Once a state is set, `chat` reads null: the real thread is
    hidden, sends are refused, the polls stop, consent builds no stores, and
    the frame gets no persistKey, so nothing is fetched or stored.
  • config.starters is not shown; the bar has no starter chips.
  • It owns the iframe document's reset (no margin, transparent background)
    and sets a system font, since the iframe has no site font to inherit.
  • Layout: a fixed, bottom-anchored stage aligned to the launcher's corner.
    The wrapper never shrinks (flex: none): a lagging box clips, not reflows.
  • pawbar:page is the host page's {url, title}; lib/host-page re-strips the
    query and hash, and chat-client sends it as `page`. Each one also asks the
    chat store whether a page action was heading there; if so the bar opens on
    "Here's the page".
  • Page actions and site tools: `actions` (lib/page-actions, built in main.ts
    over poster.act) gets every pawbar:act-result, and at boot the shell asks
    actions.js for its tools (poster.requestTools); each pawbar:tools reply
    replaces the registry in lib/page-tools. Both arrive on the loader channel,
    so the same fail-closed gate covers them.
-->
<script lang="ts" module>
  import type { ChatStore, Message } from '../../store/chat.svelte';
  import type { OperatorStore } from '../../store/operator.svelte';

  /** The two stores that may only exist once chatting is allowed. */
  export interface ChatStores {
    chat: ChatStore;
    operator: OperatorStore;
  }

  export const CONSENT_KEY = '__pawbar_consent_v1:';
  /** The root's gutter on each side. Room for focus rings; the bar has no shadow. */
  export const STAGE_PAD = 8;

  /** The owner preview's 'thread' state: local, never sent, never saved. */
  export const SAMPLE_THREAD: Message[] = [
    { id: 'pv1', role: 'user', content: 'Do you ship internationally?', status: 'done' },
    { id: 'pv2', role: 'assistant', content: 'Yes, to most countries.', status: 'done' },
    { id: 'pv3', role: 'owner', content: 'Happy to help. Which country?', status: 'done' },
  ];
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
  import { getHostPage, setHostPage } from '../../lib/host-page';
  import { setPageTools } from '../../lib/page-tools';
  import { loadSiteFont, readSiteTheme, type SiteTheme } from '../../lib/site-theme';
  import type { ActionRunner } from '../../lib/page-actions';
  import { isFromLoader } from '../../lib/from-loader';

  let {
    config,
    poster,
    cart,
    contact,
    conversations,
    createChat,
    actions,
  }: {
    config: PawBarConfig;
    poster: PawBarPoster;
    cart: CartStore;
    contact: ContactStore;
    conversations: ConversationsStore;
    /** Builds the chat and operator stores. Called once, when chatting is allowed. */
    createChat: () => ChatStores;
    /** Settles page actions with the host page's replies. */
    actions?: ActionRunner;
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
    if (!granted || consent === 'granted') return;
    // The owner previewing their own consent step is not a visitor saying yes.
    if (!config.preview) {
      try {
        localStorage.setItem(consentKey, '1');
      } catch {
        /* blocked storage: the yes lasts for this page only */
      }
    }
    // Stores first: the frame sends its held message the moment consent flips.
    // A preview state stays off the network: no stores, no list.
    if (!demo) {
      stores ??= createChat();
      void conversations.refresh();
    }
    consent = 'granted';
  }
  // The owner preview toggles consentRequired live; show or clear the step.
  $effect(() => {
    const required = config.consentRequired;
    untrack(() => {
      if (!config.preview) return;
      if (required) consent = 'required';
      else if (consent === 'required') onconsent(true);
    });
  });
  // The owner preview's state switcher (pawbar:preview-state). Once set, the
  // frame shows the state, never the real conversation, and `chat` is null so
  // nothing reaches the stores, the polls or the network.
  let demo = $state<'rest' | 'open' | 'thread' | null>(null);
  const chat = $derived(demo ? null : (stores?.chat ?? null));

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
    const op = chat && stores?.operator;
    if (!op) return;
    if (pinned) op.start();
    else op.startClosed();
    return () => op.stop();
  });
  $effect(() => {
    if (pinned && chat) void untrack(() => conversations.refresh());
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
  // The owner preview has no loader, so its own window is the page the bar
  // sits on. Measuring the screen there sized the card for a whole monitor and
  // spilled it out of the dashboard's preview box.
  let windowW = $state(typeof window === 'undefined' ? 0 : window.innerWidth);
  let windowH = $state(typeof window === 'undefined' ? 0 : window.innerHeight);
  let loaderViewport = $state<{ w: number; h: number } | null>(null);
  const hostViewport = $derived(
    loaderViewport ?? (config.preview && windowW > 0 && windowH > 0 ? { w: windowW, h: windowH } : screenViewport()),
  );

  // ── Scheme ────────────────────────────────────────────────────────────────
  let hostScheme = $state(untrack(() => config.hostScheme));
  let prefersDark = $state(typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  const scheme = $derived(resolveScheme({ owner: config.scheme, host: hostScheme, prefersDark }));

  // ── Site theme ────────────────────────────────────────────────────────────
  let siteTheme = $state.raw<SiteTheme>(untrack(() => config.siteTheme));
  $effect(() => {
    loadSiteFont('--pawbar-font' in config.tokens ? undefined : siteTheme.fontHref);
  });
  // The owner preview tells the dashboard what it read, so the editor can say
  // "Matches acme.com" or "not detected": each theme as it lands, or null when
  // nothing came within 2s of boot (an empty theme is null too).
  // Posted on a timer so the next theme cancels a pending one; only the
  // boot wait is long.
  let booting = true;
  $effect(() => {
    const t = siteTheme;
    const to = untrack(() => config.preview && config.parentOrigin);
    if (!to) return;
    const has = Object.keys(t).length > 0;
    const id = setTimeout(
      () => window.parent.postMessage({ type: 'pawbar:site-theme', theme: has ? { ...t } : null }, to),
      booting && !has ? 2000 : 0,
    );
    booting = false;
    return () => clearTimeout(id);
  });
  /** The owner preview's scene: the site, framed beside the bar in this document. */
  const scene = () => document.querySelector<HTMLIFrameElement>('iframe.pawbar-scene')?.contentWindow ?? null;

  // ── Messages from the loader ──────────────────────────────────────────────
  let frame: ReturnType<typeof PawBarFrame> | undefined = $state();
  $effect(() => {
    const parentOrigin = untrack(() => config.parentOrigin);
    const preview = untrack(() => config.preview);
    function onMessage(ev: MessageEvent) {
      // The preview's scene speaks first, and only about the site theme. Its
      // origin is 'null' (sandboxed without allow-same-origin), so the window
      // identity is the whole check.
      if (preview && ev.source && ev.source === scene()) {
        const d = ev.data as { type?: unknown; theme?: unknown } | null;
        if (d && d.type === 'pawbar:site-theme') siteTheme = readSiteTheme(d.theme);
        return;
      }
      if (!isFromLoader(ev, { self: window, parent: window.parent, parentOrigin })) return;
      const data = ev.data as
        | { type?: string; s?: unknown; w?: unknown; h?: unknown; tools?: unknown; theme?: unknown; state?: unknown }
        | null;
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
        case 'pawbar:site-theme':
          siteTheme = readSiteTheme(data.theme);
          break;
        case 'pawbar:page': {
          setHostPage(data);
          const page = getHostPage();
          if (page && chat?.arrived(page.url)) expanded = true;
          break;
        }
        case 'pawbar:act-result':
          actions?.receive(data);
          break;
        case 'pawbar:preview-state': {
          // Owner preview only, from the dashboard at parentOrigin.
          const s = data.state;
          if (!preview || !parentOrigin || ev.origin !== parentOrigin) break;
          if (s !== 'rest' && s !== 'open' && s !== 'thread') break;
          demo = s;
          expanded = s !== 'rest';
          fullscreen = false;
          break;
        }
        case 'pawbar:tools':
          setPageTools(data.tools);
          break;
        case 'pawbar:viewport': {
          const w = Number(data.w);
          const h = Number(data.h);
          if (w > 0 && h > 0) loaderViewport = { w, h };
          break;
        }
      }
    }
    window.addEventListener('message', onMessage);
    // Listening first, so the answer cannot arrive before we can hear it.
    poster.requestTools();
    // The scene may have posted its theme before we were listening. It is
    // sandboxed to an opaque origin, so '*' is the only target that reaches
    // it, and the ask carries nothing.
    if (preview) scene()?.postMessage({ type: 'pawbar:sniff' }, '*');
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
    const side = config.launcher === 'icon' ? config.side : undefined;
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

<svelte:window bind:innerWidth={windowW} bind:innerHeight={windowH} />

<div class="stage" data-anchor={config.launcher === 'icon' ? config.side : 'center'} bind:this={stageEl}>
  <PawBarFrame
    bind:this={frame}
    bind:expanded
    bind:fullscreen
    messages={demo === 'thread' ? SAMPLE_THREAD : (chat?.messages ?? [])}
    conversationId={chat?.conversationId ?? ''}
    conversations={chat ? conversations.items : []}
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
    ontoolanswer={(id, yes) => chat?.answerTool(id, yes)}
    onrequesthuman={chat ? (req) => chat.requestHuman(req) : undefined}
    onopenconversation={chat ? onopenconversation : undefined}
    onnewconversation={chat ? onnewconversation : undefined}
    onopenchange={(o) => (cardOpen = o)}
    {cart}
    {contact}
    consent={demo === 'thread' ? 'granted' : consent}
    {onconsent}
    {hostViewport}
    {scheme}
    persistKey={demo ? '' : config.widgetId}
    placeholder={config.launcherLabel || undefined}
    greeting={config.greeting}
    logoSrc={config.logo}
    agentName={config.agentName}
    launcher={config.launcher}
    side={config.side}
    size={config.barSize}
    site={siteTheme}
    tokens={config.tokens}
    tokensDark={config.tokensDark}
    disclosure={config.disclosure}
    privacyHref={config.privacyHref}
    voice={config.voice}
    poweredBy={config.poweredBy}
    expandable={config.expandable}
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
