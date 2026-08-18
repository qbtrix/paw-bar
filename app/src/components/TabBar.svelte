<!-- TabBar.svelte — the Messenger's bottom navigation.
     Created 2026-08-19 (Messenger).

     Built four-wide even though three tabs ship: News needs an announcement
     content model that does not exist yet, and reserving the slot means adding
     it later is a new entry rather than a re-layout of a surface visitors have
     already learned. `tabs` is passed in, so the fourth appears the day it has
     something to show.

     Operate mode: the active tab is carried by THREE signals at once — a moving
     indicator, a weight change, and a fill on the glyph. Redundant on purpose.
     Colour alone fails for the visitor who cannot distinguish it and for the
     one whose owner re-skinned the accent to something low-contrast, and "which
     tab am I on" is not a question this surface may leave ambiguous.

     The indicator travels between tabs rather than cutting, which is the one
     place motion carries information here: it says the tabs are one row you
     move along, not four separate buttons. -->
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
  }: { tabs: Tab[]; active: string; onselect: (id: string) => void } = $props();

  const activeIndex = $derived(Math.max(0, tabs.findIndex((t) => t.id === active)));
</script>

<nav class="tabbar" aria-label="Concierge sections">
  <div
    class="indicator"
    style="--count:{tabs.length}; --index:{activeIndex}"
    aria-hidden="true"
  ></div>
  {#each tabs as tab (tab.id)}
    {@const isActive = tab.id === active}
    <button
      type="button"
      class="tab"
      class:active={isActive}
      aria-current={isActive ? 'page' : undefined}
      onclick={() => onselect(tab.id)}
    >
      <span class="glyph">
        <Icon name={tab.icon} filled={isActive} />
        {#if tab.badge}
          <!-- The count is announced as part of the tab's own label rather than
               as a floating number, so a screen reader says "Messages, 2 unread"
               instead of stranding a "2" beside it. -->
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
</nav>

<style>
  .tabbar {
    position: relative;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    align-items: stretch;
    flex: none;
    padding: 6px 4px calc(4px + env(safe-area-inset-bottom, 0px));
    background: var(--pawbar-tabbar-bg);
    border-top: 1px solid var(--pawbar-border);
    backdrop-filter: blur(var(--pawbar-blur));
    -webkit-backdrop-filter: blur(var(--pawbar-blur));
  }

  /* Sits behind the active tab and slides between slots. Width is a fraction of
     the row so it stays correct whether three or four tabs are passed. */
  .indicator {
    position: absolute;
    top: 4px;
    left: 4px;
    width: calc((100% - 8px) / var(--count));
    height: calc(100% - 8px - env(safe-area-inset-bottom, 0px));
    border-radius: var(--pawbar-radius-sm);
    background: oklch(1 0 0 / 0.06);
    transform: translateX(calc(var(--index) * 100% * var(--pawbar-motion-scale)));
    transition: transform var(--pawbar-duration) var(--pawbar-ease);
  }

  /* With motion off the indicator would sit under the first tab forever and
     actively mislead, so it stops being a moving object and becomes a static
     one drawn in the right slot. */
  @media (prefers-reduced-motion: reduce) {
    .indicator {
      left: calc(4px + var(--index) * ((100% - 8px) / var(--count)));
      transform: none;
    }
  }

  .tab {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 4px 7px;
    border: 0;
    border-radius: var(--pawbar-radius-sm);
    background: transparent;
    color: var(--pawbar-tab-fg);
    font: inherit;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: color var(--pawbar-duration-fast) var(--pawbar-ease);
  }

  .tab:hover {
    color: var(--pawbar-tab-fg-active);
  }

  .tab:focus-visible {
    outline: 2px solid var(--pawbar-ring);
    outline-offset: -2px;
  }

  .tab.active {
    color: var(--pawbar-tab-fg-active);
  }

  .label {
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  /* The second signal: the active label thickens. Kept off `.tab` so the glyph
     is not also re-weighted. */
  .tab.active .label {
    font-weight: 650;
  }

  .glyph {
    position: relative;
    display: block;
    font-size: 20px;
  }

  .badge,
  .dot {
    position: absolute;
    background: var(--pawbar-unread);
    color: var(--pawbar-unread-fg);
    /* Rides on the tab-bar ground rather than the glyph, so the count stays
       readable where it overlaps the icon's own strokes. */
    box-shadow: 0 0 0 2px var(--pawbar-tabbar-bg);
  }

  .badge {
    top: -5px;
    left: 11px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .dot {
    top: -1px;
    left: 14px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
