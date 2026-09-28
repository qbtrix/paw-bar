<!--
  SpecUnavailable.svelte — the fallback for a spec node the bar can't draw: a
  type outside the manifest, or a widget that threw while rendering. Created
  2026-09-27. It shows nothing at all: one missing piece of a generated block
  shouldn't leave a visible error in the reply, and the rest of the block
  still renders. The whole-card "Card unavailable" line is CardBlock's job.
-->
<script lang="ts">
  let { type }: { type: string; id?: string; error?: unknown } = $props();
</script>

<span hidden data-spec-unavailable={type}></span>
