<!-- Test stand-in fallback: shows the type it stood in for. Created 2026-09-27 for the spec renderer tests. -->
<script lang="ts">
  let { type, error }: { type: string; error?: unknown } = $props();
</script>

<em data-testid="fallback" data-error={error ? 'yes' : 'no'}>{type}</em>
