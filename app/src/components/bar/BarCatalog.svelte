<!--
  BarCatalog.svelte — a kind:"product" pawbar-card, drawn inside the new bar's
  thread (CardBlock routes here in the bar; SpecProducts reuses it for the
  `product-card` spec widget). A catalog can hand the agent many products, so:
  • One item: a compact row — thumbnail, name, price, description, CTAs.
  • Two or more: a horizontal strip of tiles (image on top, name clamped to two
    lines, price, CTAs) with scroll-snap. The scrollbar is hidden rather than
    reserved; swipe on touch, and on hover-capable devices "Previous products" /
    "Next products" buttons at the edges, hidden at the ends.
  • More than six: the first six plus a "Show all N" tile that expands into a
    wrapping grid, inline. Full screen (.frame-wrap[data-full]) always shows
    the full grid.
  • Tiles: a quiet placeholder while an image loads; a missing or broken image
    becomes the product's initial; no price, no price line. A CTA's pending
    state is that button's alone, then "Added ✓", or one error line.
  • Prices are ISO 4217 minor units, formatted by lib/money.formatMinor.
  • An item with a `url` links its name and image to that page
    (lib/cards.cardHref: http(s) only, site paths resolve against the host page
    origin). Links and checkout open a new tab: the frame is sandboxed without
    top navigation. Checkout goes through CartStore.openCheckout.

  Every field is a Svelte text/attribute binding: no HTML injection, and image
  URLs pass lib/cards.safeImageUrl. Nothing in here is a live region; the
  thread (role=log) already announces the card. Colours, radii and borders come
  only from var(--pawbar-*, fallback) in the thread's inks.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { CardItem } from '../../lib/cards';
  import { verbLabel, safeImageUrl, cardHref } from '../../lib/cards';
  import { formatMinor } from '../../lib/money';
  import { useCart } from '../../store/cart.svelte';

  let { items }: { items: CardItem[] } = $props();
  const cart = useCart();

  /** Tiles shown before "Show all N". */
  const PREVIEW = 6;
  let expanded = $state(false);
  const hidden = $derived(expanded ? 0 : Math.max(0, items.length - PREVIEW));

  // Keyed by URL, not by tile, so a re-render cannot resurrect a URL we
  // already watched fail (same rule as ProductCard).
  let broken = $state(new Set<string>());
  let loaded = $state(new Set<string>());
  // Per tile index: two tiles can carry the same product id.
  let added = $state<Record<number, boolean>>({});
  let errors = $state<Record<number, string>>({});

  // add_to_cart keeps the store's own key shape; any other verb gets a key per
  // tile, so pressing it on one tile never spins the same verb on the others.
  const keyOf = (verb: string, item: CardItem, i: number) =>
    verb === 'add_to_cart' ? `add_to_cart:${item.id}` : `${verb}:${item.id || i}`;
  const isPending = (verb: string, item: CardItem, i: number) => cart.pending === keyOf(verb, item, i);

  async function act(verb: string, item: CardItem, i: number) {
    const { [i]: _, ...rest } = errors;
    errors = rest;
    if (verb === 'checkout') {
      // Synchronous, inside the click gesture, so a popup blocker lets it by.
      cart.openCheckout();
      return;
    }
    const ok =
      verb === 'add_to_cart' ? await cart.addToCart(item.id) : await cart.runAction(verb, {}, keyOf(verb, item, i));
    if (!ok) {
      errors = { ...errors, [i]: cart.error ?? 'That didn’t go through — please try again.' };
      return;
    }
    if (verb !== 'add_to_cart') return;
    added = { ...added, [i]: true };
    setTimeout(() => {
      const { [i]: __, ...left } = added;
      added = left;
    }, 1400);
  }

  const label = (verb: string, i: number) =>
    verb === 'add_to_cart' && added[i] ? 'Added ✓' : verb === 'checkout' ? 'Checkout ↗' : verbLabel(verb);

  const initial = (name: string) => [...name.trim()][0]?.toUpperCase() ?? '?';

  // ── The strip's edge buttons ──────────────────────────────────────────────
  let listEl: HTMLUListElement | undefined = $state();
  let atStart = $state(true);
  let atEnd = $state(true);
  function measure() {
    if (!listEl) return;
    atStart = listEl.scrollLeft <= 2;
    atEnd = listEl.scrollLeft + listEl.clientWidth >= listEl.scrollWidth - 2;
  }
  $effect(() => {
    if (!listEl || typeof ResizeObserver === 'undefined') return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(listEl);
    return () => ro.disconnect();
  });
  // Read at call time, not through svelte/motion: a module-level MediaQuery
  // would need matchMedia at import, and CardBlock can pull this file into a
  // test that never stubs it.
  function page(dir: 1 | -1) {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    listEl?.scrollBy({ left: dir * listEl.clientWidth * 0.8, behavior: still ? 'auto' : 'smooth' });
  }

  async function showAll() {
    expanded = true;
    await tick();
    // Hand focus to the first tile that just appeared, not back to the top.
    listEl?.querySelectorAll('li')[PREVIEW]?.querySelector<HTMLElement>('button')?.focus();
  }
</script>

{#snippet thumb(item: CardItem)}
  {@const raw = item.image_url ?? ''}
  {@const src = broken.has(raw) ? '' : safeImageUrl(raw)}
  {@const href = cardHref(item)}
  <!-- As a link it is a pointer convenience: out of the tab order and hidden
       from AT, because the name link right below carries the same target. -->
  <svelte:element
    this={href ? 'a' : 'div'}
    class="img"
    class:empty={!src}
    class:ready={!!src && loaded.has(src)}
    href={href ?? undefined}
    target={href ? '_blank' : undefined}
    rel={href ? 'noopener noreferrer' : undefined}
    tabindex={href ? -1 : undefined}
    aria-hidden={href ? 'true' : undefined}
  >
    {#if src}
      <img
        {src}
        alt=""
        loading="lazy"
        decoding="async"
        onload={() => (loaded = new Set(loaded).add(src))}
        onerror={() => (broken = new Set(broken).add(raw))}
      />
    {:else}
      <span class="initial" aria-hidden="true">{initial(item.name)}</span>
    {/if}
  </svelte:element>
{/snippet}

{#snippet nameLink(item: CardItem, clamp: boolean)}
  {@const href = cardHref(item)}
  {#if href}
    <a class="name" class:clamp {href} target="_blank" rel="noopener noreferrer">{item.name}</a>
  {:else}
    <span class="name" class:clamp>{item.name}</span>
  {/if}
{/snippet}

{#snippet ctas(item: CardItem, i: number)}
  {#if item.actions.length > 0}
    <div class="ctas">
      {#each item.actions as verb, k (k)}
        {@const pending = isPending(verb, item, i)}
        <button
          type="button"
          class="cta"
          class:primary={verb === 'add_to_cart'}
          class:pending
          aria-busy={pending || undefined}
          aria-label={verb === 'checkout' ? 'Checkout, opens in a new tab' : undefined}
          disabled={verb === 'add_to_cart' && !item.id}
          onclick={() => !pending && act(verb, item, i)}
        >
          <span class="cta-label">{label(verb, i)}</span>
          {#if pending}<span class="spin" aria-hidden="true"></span>{/if}
        </button>
      {/each}
    </div>
  {/if}
  {#if errors[i]}<p class="err">{errors[i]}</p>{/if}
{/snippet}

{#if items.length === 1}
  {@const item = items[0]}
  {@const price = formatMinor(item.price_cents, item.currency)}
  <article class="one">
    {@render thumb(item)}
    <div class="body">
      <div class="title-row">
        {@render nameLink(item, false)}
        {#if price}<span class="price">{price}</span>{/if}
      </div>
      {#if item.description}<p class="desc">{item.description}</p>{/if}
      {@render ctas(item, 0)}
    </div>
  </article>
{:else}
  <div class="catalog" class:grid={expanded}>
    <ul class="list" role="list" aria-label="Products" bind:this={listEl} onscroll={measure}>
      {#each items as item, i (i)}
        {@const price = formatMinor(item.price_cents, item.currency)}
        <li class="tile" class:extra={i >= PREVIEW}>
          {@render thumb(item)}
          <div class="body">
            {@render nameLink(item, true)}
            {#if price}<span class="price">{price}</span>{/if}
            {@render ctas(item, i)}
          </div>
        </li>
      {/each}
      {#if hidden > 0}
        <li class="tile more">
          <button type="button" class="more-btn" onclick={showAll}>Show all {items.length}</button>
        </li>
      {/if}
    </ul>
    {#if !expanded}
      <button type="button" class="arrow prev" aria-label="Previous products" hidden={atStart} onclick={() => page(-1)}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <button type="button" class="arrow next" aria-label="Next products" hidden={atEnd} onclick={() => page(1)}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    {/if}
  </div>
{/if}

<style>
  /* ── Shared by the row and the tiles ─────────────────────────────────────
     Card surfaces per the E spec: --pawbar-card-bg / --pawbar-card-border,
     falling back to the frame's own ink and hairline. */
  .one,
  .tile {
    border: 1px solid var(--pawbar-card-border, var(--pawbar-frame-border, rgb(255 255 255 / 0.14)));
    border-radius: min(var(--pawbar-radius, 12px), 12px);
    background: var(--pawbar-card-bg, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 6%, transparent));
    color: var(--pawbar-frame-fg, #f2f2f5);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .name {
    font-size: calc(var(--pbf-msg, 15px) - 1px);
    font-weight: 600;
    line-height: 1.3;
  }
  a.name {
    color: inherit;
    text-decoration: none;
  }
  a.name:hover {
    text-decoration: underline;
  }
  .price {
    flex: none;
    font-size: var(--pbf-meta, 12.5px);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .desc {
    margin: 0;
    font-size: var(--pbf-meta, 12.5px);
    line-height: 1.45;
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }

  /* The image block is its own placeholder: the card tint while the picture
     loads, the initial when there is no picture to load. */
  .img {
    position: relative;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: min(var(--pawbar-radius, 8px), 8px);
    background: var(--pawbar-card-bg, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 6%, transparent));
  }
  .img img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 180ms ease;
  }
  .img.ready img {
    opacity: 1;
  }
  .initial {
    font-size: 1.4em;
    font-weight: 600;
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }

  /* ── One item: a row ──────────────────────────────────────────────────── */
  .one {
    display: flex;
    max-width: 460px;
    gap: 12px;
    margin: 6px 0;
    padding: 10px;
  }
  .one .img {
    flex: none;
    width: 64px;
    height: 64px;
  }
  .one .body {
    flex: 1;
  }
  .title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }

  /* ── Two or more: a strip ────────────────────────────────────────────────
     The strip is as wide as the thread (which is `contain: inline-size`, so
     the tiles can never widen the frame) and scrolls sideways under it. */
  .catalog {
    position: relative;
    margin: 6px 0;
    min-width: 0;
  }
  .list {
    display: flex;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
    scroll-behavior: smooth;
    /* Hidden, not reserved: arrows and swipe do the scrolling, and a
       scrollbar that appears and vanishes is exactly the flicker to avoid. */
    scrollbar-width: none;
  }
  .list::-webkit-scrollbar {
    display: none;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 0 0 clamp(128px, 42%, 172px);
    min-width: 0;
    padding: 8px;
    box-sizing: border-box;
    scroll-snap-align: start;
  }
  .tile .img {
    aspect-ratio: 4 / 3;
  }
  .tile .body {
    flex: 1;
  }
  .clamp {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .tile.extra {
    display: none;
  }
  .tile.more {
    display: grid;
    place-items: center;
    padding: 0;
    background: none;
    border-style: dashed;
  }
  .more-btn {
    width: 100%;
    height: 100%;
    min-height: 88px;
    padding: 8px;
    border: none;
    border-radius: inherit;
    background: none;
    color: var(--pawbar-frame-fg, #f2f2f5);
    font: inherit;
    font-size: var(--pbf-meta, 12.5px);
    font-weight: 600;
    cursor: pointer;
  }
  .more-btn:hover {
    background: var(--pawbar-thread-wash, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 9%, transparent));
  }

  /* ── The grid: "Show all", and always in full screen ─────────────────── */
  .catalog.grid .list,
  :global(.frame-wrap[data-full]) .list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    overflow: visible;
  }
  .catalog.grid .tile.extra,
  :global(.frame-wrap[data-full]) .tile.extra {
    display: flex;
  }
  :global(.frame-wrap[data-full]) .tile.more,
  :global(.frame-wrap[data-full]) .arrow {
    display: none;
  }

  /* ── Edge buttons: hover-capable devices only; touch swipes ─────────── */
  .arrow {
    position: absolute;
    top: 28%;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--pawbar-thread-line, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent));
    border-radius: 50%;
    background: var(--pawbar-bubble-bg, rgb(255 255 255 / 0.86));
    color: var(--pawbar-bubble-fg, #1c1c21);
    cursor: pointer;
    opacity: 0;
    transition: opacity 150ms ease;
  }
  .arrow.prev {
    left: 4px;
  }
  .arrow.next {
    right: 4px;
  }
  .catalog:hover .arrow,
  .catalog:focus-within .arrow {
    opacity: 1;
  }
  .arrow[hidden] {
    display: none;
  }
  @media (hover: none) {
    .arrow {
      display: none;
    }
  }

  /* ── CTAs ─────────────────────────────────────────────────────────────── */
  .ctas {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: auto;
    padding-top: 2px;
  }
  .cta {
    position: relative;
    padding: 6px 12px;
    border: 1px solid var(--pawbar-thread-line, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent));
    border-radius: min(var(--pawbar-radius, 8px), 8px);
    background: none;
    color: var(--pawbar-frame-fg, #f2f2f5);
    font: inherit;
    font-size: var(--pbf-meta, 12.5px);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .tile .cta {
    flex: 1 1 auto;
  }
  .cta:hover:not(:disabled) {
    background: var(--pawbar-thread-wash, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 9%, transparent));
  }
  /* The site's accent when it has one; otherwise the visitor-bubble pair,
     which contrasts the frame in every theme (the accent's own fallback is
     near-black and vanishes on the default dark frame). */
  .cta.primary {
    border-color: transparent;
    background: var(--pawbar-accent, var(--pawbar-bubble-bg, rgb(255 255 255 / 0.86)));
    color: var(--pawbar-accent-fg, var(--pawbar-bubble-fg, #1c1c21));
  }
  .cta.primary:hover:not(:disabled) {
    background: color-mix(in oklab, var(--pawbar-accent, var(--pawbar-bubble-bg, rgb(255 255 255 / 0.86))) 88%, var(--pawbar-frame-fg, #f2f2f5));
  }
  .cta:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .cta.pending {
    cursor: progress;
  }
  /* Pending: the label keeps its space (so nothing reflows) and a 12px
     spinner sits over it. */
  .cta.pending .cta-label {
    visibility: hidden;
  }
  .spin {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 12px;
    height: 12px;
    box-sizing: border-box;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: pbc-spin 700ms linear infinite;
  }
  @keyframes pbc-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .cta:focus-visible,
  .more-btn:focus-visible,
  .arrow:focus-visible {
    outline: 2px solid var(--pawbar-ring, var(--pawbar-frame-fg, #f2f2f5));
    outline-offset: 2px;
  }
  .err {
    margin: 2px 0 0;
    font-size: var(--pbf-meta, 12.5px);
    line-height: 1.35;
    color: var(--pawbar-danger, color-mix(in oklab, #d93036 72%, var(--pawbar-frame-fg, #f2f2f5)));
  }

  /* Reduced motion: no spinner (a static "…" after the label instead), no
     fades, no smooth scrolling. */
  @media (prefers-reduced-motion: reduce) {
    .spin {
      display: none;
    }
    .cta.pending .cta-label {
      visibility: visible;
    }
    .cta.pending .cta-label::after {
      content: '…';
    }
    .img img,
    .arrow {
      transition: none;
    }
    .list {
      scroll-behavior: auto;
    }
  }
</style>
