<!-- Test stand-in: echoes the class and style it was given. Created 2026-09-27 for the spec renderer tests. -->
<script lang="ts">
  let { id, class: className, style }: { id?: string; class?: string; style?: string } = $props();
</script>

<div data-testid={id} class={className} {style}></div>
