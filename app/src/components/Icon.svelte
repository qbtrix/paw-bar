<!-- Icon.svelte — the widget's whole icon system, authored rather than imported.
     Created 2026-08-19 (Messenger).

     One component holding a path map, for two reasons. The bundle is budgeted
     at 80KB gzipped (scripts/check-size.mjs) and an icon library would spend a
     meaningful slice of that on glyphs we do not use. And an icon set assembled
     from whatever each library happened to draw is how stroke weights drift
     across a surface — here every glyph is on the same 24x24 grid at the same
     1.75 stroke with round caps and joins, so they sit together at any size.

     Sized in `em` so an icon inherits the type scale of whatever it labels
     instead of needing a size prop at every call site. -->
<script module lang="ts">
  export type IconName =
    | 'home'
    | 'messages'
    | 'help'
    | 'news'
    | 'close'
    | 'back'
    | 'send'
    | 'more'
    | 'plus'
    | 'search'
    | 'attach'
    | 'emoji'
    | 'mic'
    | 'chevron-down'
    | 'expand'
    | 'shrink'
    | 'chat';

  // 24x24 grid, stroke-only. Kept as data so the markup below stays one <svg>
  // rather than a switch block that duplicates every attribute.
  const PATHS: Record<IconName, string> = {
    home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
    messages: 'M4 5.5h16v11H9l-4 3.5v-3.5H4z',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4M12 17.2v.2',
    news: 'M4 7.5h9l5-2.5v11l-5-2.5H4zM6.5 13.5V19M18 8.5a2.5 2.5 0 0 1 0 5',
    close: 'M6 6l12 12M18 6 6 18',
    back: 'M15 5l-7 7 7 7',
    send: 'M12 19V5M6 11l6-6 6 6',
    more: 'M6 12h.01M12 12h.01M18 12h.01',
    plus: 'M12 5v14M5 12h14',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16 16l4 4',
    attach: 'M20 11.5 12.5 19a4.5 4.5 0 0 1-6.4-6.4l7.6-7.5a3 3 0 0 1 4.2 4.2l-7.5 7.6a1.5 1.5 0 0 1-2.1-2.1l7-7',
    emoji: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9 10v.01M15 10v.01M8.5 14.5a4.5 4.5 0 0 0 7 0',
    mic: 'M12 3.5a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0V6A2.5 2.5 0 0 1 12 3.5ZM6 11a6 6 0 0 0 12 0M12 17v3.5',
    'chevron-down': 'M6 9.5 12 15l6-5.5',
    // Corner brackets, not arrows: the panel grows in place rather than moving,
    // and four arrows would promise a drag handle it does not have.
    expand: 'M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5',
    shrink: 'M4 9h5V4M20 9h-5V4M20 15h-5v5M4 15h5v5',
    chat: 'M4 5.5h16v11H9l-4 3.5v-3.5H4z',
  };

</script>

<script lang="ts">
  let {
    name,
    filled = false,
    size = '1.25em',
  }: { name: IconName; filled?: boolean; size?: string } = $props();
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
  class:filled
>
  <path d={PATHS[name]} />
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }

  /* The active tab reads as filled without a second set of glyphs: the same
     stroke path, closed and tinted at low alpha behind its own outline. Only
     the closed shapes benefit, which is why it is opt-in per call site. */
  .filled path {
    fill: currentColor;
    fill-opacity: 0.16;
  }
</style>
