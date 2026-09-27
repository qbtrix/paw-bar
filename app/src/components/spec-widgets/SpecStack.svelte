<!--
  SpecStack.svelte — the `stack` widget: lays its children out in a column
  (default) or a wrapping row. Created 2026-09-27. `gap` is sm, md (default) or
  lg; `align` is start (default), center or end. The only layout widget in the
  manifest, on purpose: a chat reply needs rows and columns, not grids.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { oneOf } from './props';

  let {
    direction,
    gap,
    align,
    children,
    class: className,
    style,
  }: {
    direction?: unknown;
    gap?: unknown;
    align?: unknown;
    children?: Snippet;
    class?: string;
    style?: string;
  } = $props();

  const dir = $derived(oneOf(direction, ['column', 'row'], 'column'));
  const g = $derived(oneOf(gap, ['sm', 'md', 'lg'], 'md'));
  const a = $derived(oneOf(align, ['start', 'center', 'end'], 'start'));
</script>

<div class={['spec-stack', dir, `gap-${g}`, `align-${a}`, className]} {style}>{@render children?.()}</div>

<style>
  .spec-stack {
    display: flex;
    min-width: 0;
  }
  .column {
    flex-direction: column;
  }
  .row {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .gap-sm {
    gap: 4px;
  }
  .gap-md {
    gap: 8px;
  }
  .gap-lg {
    gap: 14px;
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
