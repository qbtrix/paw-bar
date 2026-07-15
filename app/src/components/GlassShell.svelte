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
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { ChatStore } from '../store/chat.svelte';
  import { type CartStore, provideCart } from '../store/cart.svelte';
  import type { PawBarPoster } from '../lib/postmessage';
  import MessageList from './MessageList.svelte';
  import Composer from './Composer.svelte';
  import CartBadge from './CartBadge.svelte';

  let {
    store,
    cart,
    poster,
    theme = 'dark',
    parentOrigin = '',
  }: {
    store: ChatStore;
    cart: CartStore;
    poster: PawBarPoster;
    theme?: 'light' | 'dark';
    parentOrigin?: string;
  } = $props();

  // Expose the cart to descendant card CTAs (Markdown → CardBlock → ProductCard)
  // + the header badge without prop-drilling through the transcript. untrack:
  // the store instance is created once in main.ts and never reassigned, so we
  // capture it at init without registering a reactive dependency.
  provideCart(untrack(() => cart));

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
    poster.open();
    // Initial cart hydrate on the first open (one-shot inside the store).
    void cart.load();
    queueMicrotask(() => composer?.focus());
  }
  function closePanel() {
    view = 'bar';
    poster.view('bar');
    persistDock('bar');
    queueMicrotask(() => composer?.focus());
  }
  function minimize() {
    view = 'chip';
    poster.view('chip');
    persistDock('chip');
  }
  function restoreBar() {
    view = 'bar';
    poster.view('bar');
    persistDock('bar');
    queueMicrotask(() => composer?.focus());
  }

  // Sending from the bar morphs into the panel so the reply streams in place.
  function handleBarSend(text: string) {
    openPanel();
    void store.send(text);
  }
  function handlePanelSend(text: string) {
    void store.send(text);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || drag) return;
    if (view === 'panel') closePanel();
    else if (view === 'bar') minimize();
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
    if (view !== 'bar' || drag || awaitingBox) return;
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

<svelte:window onkeydown={onKeydown} />

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
      <button type="button" class="chip" onclick={restoreBar} aria-expanded="false" aria-label="Open concierge bar">
        <span class="glow-dot"></span>
        <span>Ask</span>
      </button>
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
        <span class="glow-dot"></span>
        <div class="bar-composer">
          <Composer
            bind:this={composer}
            isStreaming={store.isStreaming}
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
        <header class="head">
          <div class="head-title">
            <span class="head-dot"></span>
            <span>Concierge</span>
          </div>
          <div class="head-actions">
            <CartBadge />
            <button type="button" class="icon-btn" onclick={closePanel} aria-label="Close">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
              </svg>
            </button>
          </div>
        </header>

        {#if store.messages.length === 0}
          <div class="empty">
            <span class="glow-dot empty-dot"></span>
            <p class="empty-title">Ask about this site</p>
            <p class="empty-sub">Instant answers, grounded in this site's own knowledge.</p>
          </div>
        {:else}
          <MessageList messages={store.messages} />
        {/if}

        {#if store.error}
          <div class="banner" role="status">{store.error}</div>
        {/if}

        <div class="composer-wrap">
          <Composer
            bind:this={composer}
            isStreaming={store.isStreaming}
            onSend={handlePanelSend}
            onStop={() => store.stop()}
          />
        </div>
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
  .empty {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 24px;
    text-align: center;
  }
  .empty-dot {
    width: 10px;
    height: 10px;
    box-shadow: 0 0 18px var(--pawbar-accent);
    margin-bottom: 8px;
  }
  .empty-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .empty-sub {
    margin: 0;
    font-size: 13px;
    color: var(--pawbar-fg-muted);
    max-width: 260px;
    line-height: 1.45;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid var(--pawbar-border);
  }
  .head-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .head-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--pawbar-accent);
  }
  .head-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
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
  .banner {
    margin: 8px 14px 0;
    padding: 7px 10px;
    border-radius: 9px;
    font-size: 12px;
    color: var(--pawbar-danger);
    background: color-mix(in oklab, var(--pawbar-danger) 12%, transparent);
    border: 1px solid color-mix(in oklab, var(--pawbar-danger) 30%, transparent);
  }
  .composer-wrap {
    padding: 12px;
    border-top: 1px solid var(--pawbar-border);
  }
</style>
