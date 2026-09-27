<!--
  SpecButton.svelte — the `button` widget. Created 2026-09-27. Styled like the
  catalog's CTAs (BarCatalog `.cta`). Props follow Ripple's standard slim atom:
  `variant` "default" (the main action) takes the site's accent; "secondary"
  and "outline" are the outlined button. The click runs the
  node's `on_click` through the spec runtime: local state actions, or an `emit`
  the thread turns into a bar action (see SpecCard.svelte).
-->
<script lang="ts">
  import { asString, oneOf } from './props';

  let {
    label,
    variant,
    disabled,
    onclick,
    class: className,
    style,
  }: {
    label?: unknown;
    variant?: unknown;
    disabled?: unknown;
    onclick?: (value?: unknown) => unknown;
    class?: string;
    style?: string;
  } = $props();

  const v = $derived(oneOf(variant, ['default', 'secondary', 'outline'], 'default'));
</script>

<button
  type="button"
  class={['spec-button', v, className]}
  {style}
  disabled={disabled === true}
  onclick={() => onclick?.()}>{asString(label, 60)}</button
>

<style>
  .spec-button {
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
  .spec-button:hover:not(:disabled) {
    background: var(--pawbar-thread-wash, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 9%, transparent));
  }
  .default {
    border-color: transparent;
    background: var(--pawbar-accent, var(--pawbar-bubble-bg, rgb(255 255 255 / 0.86)));
    color: var(--pawbar-accent-fg, var(--pawbar-bubble-fg, #1c1c21));
  }
  .default:hover:not(:disabled) {
    background: color-mix(in oklab, var(--pawbar-accent, var(--pawbar-bubble-bg, rgb(255 255 255 / 0.86))) 88%, var(--pawbar-frame-fg, #f2f2f5));
  }
  .spec-button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .spec-button:focus-visible {
    outline: 2px solid var(--pawbar-ring, var(--pawbar-accent, currentColor));
    outline-offset: 2px;
  }
</style>
