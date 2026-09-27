<!-- Test stand-in: records which slot snippets it received. Created 2026-09-27 for the spec renderer tests. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    header,
    children,
    hasChildren
  }: { header?: Snippet; children?: Snippet; hasChildren?: boolean } = $props();
</script>

<section
  data-testid="box"
  data-has-header={header ? 'yes' : 'no'}
  data-has-children={children ? 'yes' : 'no'}
  data-has-children-flag={hasChildren ? 'yes' : 'no'}
>
  {#if header}<header>{@render header()}</header>{/if}
  {#if children}<div>{@render children()}</div>{/if}
</section>
