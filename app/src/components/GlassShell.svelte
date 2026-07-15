<!--
  GlassShell.svelte — The three-state morph shell for the concierge iframe:
  collapsed pill → input bar → full panel. Created 2026-07-15 (A3 glass bar).
  CLICK + ESCAPE driven and mobile-safe (never hover-driven). The frosted glass
  is a translucent tinted surface + backdrop-blur on the panel itself (there's
  no Tauri vibrancy inside an iframe over an unknown host bg). A ResizeObserver
  posts {pawbar:resize,h} up to the loader on every size change; opening posts
  {pawbar:open}, collapsing to the pill posts {pawbar:close}. Owns nothing but
  view state — the transcript/streaming lives in the injected ChatStore.

  2026-07-15 sizing fix: the ResizeObserver now measures an inner .pawbar-content
  wrapper, not .pawbar-root. The root is position:fixed inset:0 so its height IS
  the iframe's height — observing it posted the iframe's own height back to the
  loader, a stuck loop that collapsed the opened panel to MIN_H (the "folding"
  bug). Root is now transparent chrome (pointer-events:none); the content
  wrapper catches clicks and is the sole sizing source (+ROOT_PAD for padding).
-->
<script lang="ts">
  import type { ChatStore } from '../store/chat.svelte';
  import type { PawBarPoster } from '../lib/postmessage';
  import MessageList from './MessageList.svelte';
  import Composer from './Composer.svelte';

  let {
    store,
    poster,
    theme = 'dark',
  }: {
    store: ChatStore;
    poster: PawBarPoster;
    theme?: 'light' | 'dark';
  } = $props();

  type View = 'pill' | 'bar' | 'panel';
  let view = $state<View>('pill');
  let rootEl: HTMLDivElement | null = $state(null);
  let contentEl: HTMLDivElement | null = $state(null);
  let composer: ReturnType<typeof Composer> | null = $state(null);

  function openBar() {
    view = 'bar';
    poster.open();
    queueMicrotask(() => composer?.focus());
  }
  function expandPanel() {
    view = 'panel';
    poster.open();
  }
  function collapse() {
    view = 'pill';
    poster.close();
  }
  function onEscape() {
    if (view === 'panel') view = store.messages.length > 0 ? 'bar' : 'pill';
    else if (view === 'bar') view = 'pill';
    if (view === 'pill') poster.close();
  }

  function handleSend(text: string) {
    if (view !== 'panel') expandPanel();
    void store.send(text);
  }

  function onKeydown(e: KeyboardEvent) {
    // Escape collapses one level from anywhere (including composer focus).
    // No-op in the pill state — nothing to collapse.
    if (e.key === 'Escape' && view !== 'pill') onEscape();
  }

  // Report our rendered CONTENT height to the loader so the iframe fits each
  // state. We observe the inner content wrapper, NOT .pawbar-root: the root is
  // position:fixed inset:0, so its height IS the iframe's own height — observing
  // it feeds the loader back the height it just set, a stuck loop that collapses
  // the opened panel to the loader's MIN_H (the "folding" bug). ROOT_PAD is the
  // root's 12px top + 12px bottom padding, added so the iframe box wraps the
  // content plus its breathing room.
  const ROOT_PAD = 24;
  $effect(() => {
    if (!contentEl) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? contentEl?.offsetHeight ?? 0;
      poster.resize(h + ROOT_PAD);
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
  bind:this={rootEl}
  role="region"
  aria-label="Site concierge"
>
  <div class="pawbar-content" bind:this={contentEl}>
    {#if view === 'pill'}
    <button type="button" class="pill" onclick={openBar} aria-expanded="false">
      <span class="pill-dot"></span>
      <span class="pill-label">Ask about this site</span>
    </button>
  {:else}
    <section class="panel" class:is-bar={view === 'bar'}>
      {#if view === 'panel'}
        <header class="head">
          <div class="head-title">
            <span class="head-dot"></span>
            <span>Concierge</span>
          </div>
          <button type="button" class="icon-btn" onclick={collapse} aria-label="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
            </svg>
          </button>
        </header>
        <MessageList messages={store.messages} />
      {:else}
        <div class="bar-head">
          <span class="bar-hint">Ask about this site</span>
          <button type="button" class="icon-btn" onclick={collapse} aria-label="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      {/if}

      {#if store.error && view === 'panel'}
        <div class="banner" role="status">{store.error}</div>
      {/if}

      <div class="composer-wrap">
        <Composer
          bind:this={composer}
          isStreaming={store.isStreaming}
          onSend={handleSend}
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
    /* The root spans the whole (often transiently taller) iframe but is
       transparent chrome — only the content wrapper below should catch clicks. */
    pointer-events: none;
  }

  /* The measured content box: pill or panel. Kept separate from .pawbar-root so
     the ResizeObserver reads real content height, not the fixed root's iframe
     height. Re-enables pointer events the root switched off. */
  .pawbar-content {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    min-height: 0;
    max-height: 100%;
  }

  /* ── Collapsed pill ─────────────────────────────────────────────────────── */
  .pill {
    align-self: flex-end;
    display: inline-flex;
    align-items: center;
    gap: 9px;
    padding: 11px 16px;
    border-radius: 999px;
    border: 1px solid var(--pawbar-border);
    background: var(--pawbar-surface);
    -webkit-backdrop-filter: blur(var(--pawbar-blur));
    backdrop-filter: blur(var(--pawbar-blur));
    box-shadow: var(--pawbar-shadow);
    color: var(--pawbar-fg);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: transform 0.16s ease, background 0.16s ease;
  }
  .pill:hover {
    transform: translateY(-1px);
  }
  .pill-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--pawbar-accent);
    box-shadow: 0 0 10px var(--pawbar-accent);
  }

  /* ── Panel / bar (shared frosted surface) ───────────────────────────────── */
  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    max-height: 100%;
    height: 560px;
    border-radius: var(--pawbar-radius);
    border: 1px solid var(--pawbar-border);
    background: var(--pawbar-surface);
    -webkit-backdrop-filter: blur(var(--pawbar-blur)) saturate(1.4);
    backdrop-filter: blur(var(--pawbar-blur)) saturate(1.4);
    box-shadow: var(--pawbar-shadow);
    overflow: hidden;
  }
  .panel.is-bar {
    height: auto;
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
  .bar-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 8px 2px 14px;
  }
  .bar-hint {
    font-size: 12px;
    color: var(--pawbar-fg-muted);
  }
  .icon-btn {
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
  .panel.is-bar .composer-wrap {
    border-top: none;
    padding-top: 6px;
  }
</style>
