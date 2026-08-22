<!-- TabBar.svelte — the Messenger's section nav.
     Created 2026-08-19 (Messenger).

     2026-08-19 (captain direction): moved from the BOTTOM to the top, and
     re-drawn as segmented pills matching paw-enterprise's WorkspaceTabs — a
     recessed track holding one raised pill, icon and label side by side. It is
     the same control the rest of the product uses for "which section am I in",
     so a customer who has seen the desktop app already knows what it does.

     Built four-wide even though three tabs ship: News needs an announcement
     content model that does not exist yet, and reserving the shape means
     adding it later is a new entry rather than a re-layout of a surface
     visitors have already learned. `tabs` is passed in, so the fourth appears
     the day it has something to show.

     The active tab is carried by THREE signals at once — a raised surface, a
     weight change, and colour. Redundant on purpose. Colour alone fails for the
     visitor who cannot distinguish it and for the one whose owner re-skinned
     the accent to something low-contrast, and "which tab am I on" is not a
     question this surface may leave ambiguous.

     2026-08-19 (a11y): this is a real tablist now. It used to claim nothing and
     behave like a row of buttons — which was honest, but meant Tab stepped
     through every section on the way to the content. Arrow keys move between
     tabs, Home/End jump to the ends, and only the active tab is in the page's
     tab order (roving tabindex), which is the pattern a screen-reader user is
     promised the moment they hear "tab list". -->
<script module lang="ts">
  import { type IconName } from './Icon.svelte';

  export interface Tab {
    id: string;
    label: string;
    icon: IconName;
    /** Unread count. 0 renders nothing; >99 renders "99+". */
    badge?: number;
    /** A quiet dot for "something new" where a count would overstate it. */
    dot?: boolean;
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    tabs,
    active,
    onselect,
    /** id prefix for the panes this controls, so aria-controls resolves. */
    panePrefix = 'pawbar-pane',
  }: {
    tabs: Tab[];
    active: string;
    onselect: (id: string) => void;
    panePrefix?: string;
  } = $props();

  let buttons: HTMLButtonElement[] = $state([]);
  let navEl: HTMLElement | null = $state(null);
  let trackEl: HTMLElement | null = $state(null);

  // ── Do the labels fit? ────────────────────────────────────────────────────
  // MEASURED, not guessed. A CSS threshold — media or container query — encodes
  // how much room the labels NEED as a hard-coded number, and that number is
  // wrong the moment a fourth tab ships or a site is localized ("Nachrichten"
  // is half again as wide as "Messages"). It was also wrong on day one: the
  // guess said hide below 258px and the labels actually needed 253.
  //
  // So the track measures its own full width once, and compares. `fullWidth` is
  // only ever re-measured while the labels ARE showing, which is what stops the
  // obvious oscillation — hiding labels shrinks the track, a naive re-measure
  // would then say they fit, and they would flicker on and off forever.
  let compact = $state(false);
  let fullWidth = 0;

  $effect(() => {
    const nav = navEl;
    const track = trackEl;
    if (!nav || !track) return;
    const measure = () => {
      if (!compact) fullWidth = track.scrollWidth;
      const available = nav.clientWidth;
      // 1px of slack: sub-pixel layout can make a track that fits report a
      // scrollWidth one larger than the box it fits in.
      if (fullWidth > 0) compact = available + 1 < fullWidth;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    ro.observe(track);
    return () => ro.disconnect();
  });

  /** Arrow keys move selection AND focus together — automatic activation, which
   *  is right here because every pane is already mounted and switching costs
   *  nothing. Manual activation (arrow to move, Enter to select) is for tabs
   *  whose panels are expensive, and it makes a keyboard user press twice for
   *  every section. */
  function onKeydown(e: KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === active);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onselect(tabs[next].id);
    buttons[next]?.focus();
  }
</script>

<div class="navbar" bind:this={navEl}>
  <div class="track" class:compact role="tablist" aria-label="Concierge sections" bind:this={trackEl}>
    {#each tabs as tab, i (tab.id)}
      {@const isActive = tab.id === active}
      <button
        bind:this={buttons[i]}
        type="button"
        class="tab"
        class:active={isActive}
        role="tab"
        id={`${panePrefix}-tab-${tab.id}`}
        aria-selected={isActive}
        aria-controls={`${panePrefix}-${tab.id}`}
        tabindex={isActive ? 0 : -1}
        onkeydown={onKeydown}
        onclick={() => onselect(tab.id)}
      >
        <span class="glyph">
          <Icon name={tab.icon} size="1em" />
          {#if tab.badge}
            <!-- The count is announced as part of the tab's own label rather
                 than as a floating number, so a screen reader says
                 "Messages, 2 unread" instead of stranding a "2" beside it. -->
            <span class="badge">{tab.badge > 99 ? '99+' : tab.badge}</span>
            <span class="sr-only">{tab.badge} unread</span>
          {:else if tab.dot}
            <span class="dot"></span>
            <span class="sr-only">new</span>
          {/if}
        </span>
        <span class="label">{tab.label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .navbar {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  /* The recessed track. `min-width: 0` + the scroller below keep a fourth tab
     (or a long localized label) from stretching the panel — the nav gives way
     before the panel does. */
  .track {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    max-width: 100%;
    padding: 3px;
    border-radius: var(--pawbar-radius-md);
    background: var(--pawbar-nav-track);
    border: 1px solid var(--pawbar-border);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .track::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    padding: 6px 11px;
    border: 1px solid transparent;
    border-radius: var(--pawbar-radius-sm);
    background: transparent;
    color: var(--pawbar-nav-fg);
    font: inherit;
    font-size: 12.5px;
    line-height: 1;
    font-weight: 500;
    letter-spacing: -0.008em;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      color var(--pawbar-duration-fast) var(--pawbar-ease),
      background var(--pawbar-duration-fast) var(--pawbar-ease),
      border-color var(--pawbar-duration-fast) var(--pawbar-ease);
  }

  .tab:hover:not(.active) {
    color: var(--pawbar-nav-fg-active);
    background: var(--pawbar-wash);
  }

  .tab:focus-visible {
    outline: 2px solid var(--pawbar-ring);
    outline-offset: 1px;
  }

  /* Raised, bordered and weighted — a surface change rather than a tint, so it
     survives an owner re-skin and reads for anyone who cannot separate the two
     greys the colour signal relies on. */
  .tab.active {
    color: var(--pawbar-nav-fg-active);
    background: var(--pawbar-nav-active-bg);
    border-color: var(--pawbar-border-strong);
    font-weight: 620;
  }

  .glyph {
    position: relative;
    display: block;
    font-size: 15px;
  }

  .badge,
  .dot {
    position: absolute;
    background: var(--pawbar-unread);
    color: var(--pawbar-unread-fg);
    /* Rides on the track ground rather than the glyph, so the count stays
       readable where it overlaps the icon's own strokes. */
    box-shadow: 0 0 0 2px var(--pawbar-nav-track);
  }

  .badge {
    top: -6px;
    left: 8px;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    border-radius: var(--pawbar-radius-xs);
    font-size: 9.5px;
    font-weight: 700;
    line-height: 15px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .dot {
    top: -2px;
    left: 10px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  /* When the nav is squeezed — a cart badge in the header, a fourth tab, a
     long localized label — the labels go before anything else does. The glyph
     plus the accessible name still carries the tab, and losing a label is
     better than a track that scrolls sideways or an action button pushed off
     the header entirely. Driven by the measurement above, not by a breakpoint. */
  .track.compact .label {
    display: none;
  }

  .track.compact .tab {
    padding: 7px 10px;
  }

  /* All three of the active tab's signals are colour or surface, and forced
     colors discards both — leaving three identically-bordered pills and no way
     to see which section you are on. Verified under emulated forced-colors:
     the selected tab was indistinguishable. Highlight/HighlightText are system
     colours, so they survive where our own tokens do not, and they are what the
     platform itself uses to mean "this one is selected". */
  @media (forced-colors: active) {
    .tab.active {
      background: Highlight;
      color: HighlightText;
      forced-color-adjust: none;
    }
    .tab.active :global(svg) {
      stroke: HighlightText;
    }
  }

</style>
