<!-- Test stand-in: prints its `content` prop. Created 2026-09-27 for the spec renderer tests. -->
<script lang="ts">
  let { content = '', id }: { content?: string; id?: string } = $props();
</script>

<span data-testid={id ?? 'label'}>{content}</span>
