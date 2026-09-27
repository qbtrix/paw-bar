<!-- Test stand-in: a text input using the default bind contract (`value` / `onchange`). Created 2026-09-27 for the spec renderer tests. -->
<script lang="ts">
  let {
    value = '',
    name,
    onchange,
    oninput
  }: {
    value?: string;
    name?: string;
    onchange?: (v: string) => void;
    oninput?: (v: string) => void;
  } = $props();
</script>

<input
  data-testid="field"
  {name}
  {value}
  onchange={(e) => onchange?.(e.currentTarget.value)}
  oninput={(e) => oninput?.(e.currentTarget.value)}
/>
