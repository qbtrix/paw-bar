<!--
  MdBlocks.svelte — draws Block nodes (lib/md/types.ts). Created 2026-09-27
  with the native markdown renderer.

  Emits the same elements marked did, so the thread's `.pawbar-md` styles in
  PawBarFrame apply unchanged: tables sit inside div.pawbar-table-wrapper for
  mobile scroll, `align` stays an attribute, an ordered list carries `start`
  only when it isn't 1, and a task item is a disabled checkbox followed by a
  space. `tight` renders a tight list item's paragraphs without <p>, as marked
  does, because `.pawbar-md p` has its own margins.

  Markup is kept on single lines where whitespace would otherwise become text.
-->
<script lang="ts">
  import Self from './MdBlocks.svelte';
  import MdInline from './MdInline.svelte';
  import type { Block } from '../../lib/md/types';

  let { blocks, tight = false }: { blocks: Block[]; tight?: boolean } = $props();
</script>

{#each blocks as b}{#if b.t === 'p'}{#if tight}<MdInline nodes={b.c} />{:else}<p><MdInline nodes={b.c} /></p>{/if}{:else if b.t === 'h'}<svelte:element this={`h${b.level}`}><MdInline nodes={b.c} /></svelte:element>{:else if b.t === 'hr'}<hr />{:else if b.t === 'pre'}<pre><code>{b.v}</code></pre>{:else if b.t === 'quote'}<blockquote><Self blocks={b.c} /></blockquote>{:else if b.t === 'list'}{#if b.ordered}<ol start={b.start === 1 ? undefined : b.start}>{#each b.items as item}<li>{#if item.task !== null}<input type="checkbox" disabled checked={item.task} />{' '}{/if}<Self blocks={item.c} tight={!b.loose} /></li>{/each}</ol>{:else}<ul>{#each b.items as item}<li>{#if item.task !== null}<input type="checkbox" disabled checked={item.task} />{' '}{/if}<Self blocks={item.c} tight={!b.loose} /></li>{/each}</ul>{/if}{:else if b.t === 'table'}<div class="pawbar-table-wrapper"><table><thead><tr>{#each b.head as cell, k}<th align={b.align[k] ?? undefined}><MdInline nodes={cell} /></th>{/each}</tr></thead>{#if b.rows.length}<tbody>{#each b.rows as row}<tr>{#each row as cell, k}<td align={b.align[k] ?? undefined}><MdInline nodes={cell} /></td>{/each}</tr>{/each}</tbody>{/if}</table></div>{/if}{/each}
