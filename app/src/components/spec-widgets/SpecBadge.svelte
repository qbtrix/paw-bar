<!--
  SpecBadge.svelte — the `badge` widget: a short status label ("In stock",
  "Ships in 2 days"). Created 2026-09-27; props follow Ripple's standard slim
  atom: `text`, and `variant` default | success | warning | destructive.
  destructive uses --pawbar-danger. Corners follow the site's --pawbar-radius
  like every other surface (tests/radius-scale).
-->
<script lang="ts">
  import { asString, oneOf } from './props';

  let {
    text,
    variant,
    class: className,
    style,
  }: { text?: unknown; variant?: unknown; class?: string; style?: string } = $props();

  const t = $derived(oneOf(variant, ['default', 'success', 'warning', 'destructive'], 'default'));
</script>

<span class={['spec-badge', t, className]} {style}>{asString(text, 80)}</span>

<style>
  .spec-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--pawbar-radius, 8px);
    border: 1px solid var(--pawbar-thread-line, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent));
    font-size: var(--pbf-meta, 12.5px);
    font-weight: 600;
    line-height: 1.5;
    white-space: nowrap;
  }
  .success {
    background: color-mix(in oklab, #2e9d5b 18%, transparent);
  }
  .warning {
    background: color-mix(in oklab, #c98a14 20%, transparent);
  }
  .destructive {
    color: var(--pawbar-danger, #e5484d);
    border-color: color-mix(in oklab, var(--pawbar-danger, #e5484d) 40%, transparent);
  }
</style>
