<!-- Test stand-in: a button that calls `onclick`. Created 2026-09-27 for the spec renderer tests. -->
<script lang="ts">
  let { label = '', id, onclick }: { label?: string; id?: string; onclick?: () => void } = $props();
</script>

<button data-testid={id} onclick={() => onclick?.()}>{label}</button>
