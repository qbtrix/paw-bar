<!--
  SpecFlex.svelte — the `flex` widget: lays its children out in a column
  (default) or a row. Created 2026-09-27 as `stack`; renamed the same day to
  Ripple's standard slim atom `flex` (SLIM_WIDGETS in @ripple-ui/core/manifest),
  so a spec written for the bar is also a valid Ripple spec. Props follow that
  atom: `direction` row | column, `gap` in px (clamped 0-24, default 8),
  `align` start | center | end, `wrap` for a row. The only layout widget, on
  purpose: a chat reply needs rows and columns, not grids.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { oneOf } from './props';

  let {
    direction,
    gap,
    align,
    wrap,
    children,
    class: className,
    style,
  }: {
    direction?: unknown;
    gap?: unknown;
    align?: unknown;
    wrap?: unknown;
    children?: Snippet;
    class?: string;
    style?: string;
  } = $props();

  const dir = $derived(oneOf(direction, ['column', 'row'], 'column'));
  const a = $derived(oneOf(align, ['start', 'center', 'end'], 'start'));
  const px = $derived(typeof gap === 'number' && Number.isFinite(gap) ? Math.min(24, Math.max(0, Math.round(gap))) : 8);
  const gapStyle = $derived([`gap: ${px}px`, style].filter(Boolean).join('; '));
</script>

<div class={['spec-flex', dir, `align-${a}`, wrap === true && 'wrap', className]} style={gapStyle}>{@render children?.()}</div>

<style>
  .spec-flex {
    display: flex;
    min-width: 0;
  }
  .column {
    flex-direction: column;
  }
  .row {
    flex-direction: row;
  }
  .wrap {
    flex-wrap: wrap;
  }
  .align-start {
    align-items: flex-start;
  }
  .align-center {
    align-items: center;
  }
  .align-end {
    align-items: flex-end;
  }
  .column.align-start {
    align-items: stretch;
  }
</style>
