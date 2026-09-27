<!--
  SpecNode.svelte — draws one resolved Ripple node with the component the host
  supplied for its type, then its children. Created 2026-09-27 with the spec
  renderer; typed against the slim headless runtime the same day.

  Props follow Ripple's NodeRenderer so a component written for Ripple works
  here unchanged: `id`, `class`, `style`, resolved props, `name` from the bind
  path, the bound value on the bind prop, `on*` handlers, `hasChildren`, and
  one snippet per non-empty slot. `show`, `if`, `each` and expressions are
  already settled by @ripple-ui/core/headless.

  Styling: the node's `class` passes through as-is; its `style` record is
  filtered (components/spec/style.ts) and passed as a string.

  A type with no component, or a component that throws while rendering, draws
  the host's fallback (or nothing). One bad node never blanks the rest.
-->
<script lang="ts">
  import type { Component } from 'svelte';
  import type { HeadlessRuntimeBase, ResolvedNode } from '@ripple-ui/core/headless/slim';
  import Self from './SpecNode.svelte';
  import { specStyle } from './style';
  import type { SpecComponents, SpecFallbackProps } from './types';

  interface Props {
    node: ResolvedNode;
    runtime: HeadlessRuntimeBase;
    components: SpecComponents;
    fallback?: Component<SpecFallbackProps>;
  }

  let { node, runtime, components, fallback: Fallback }: Props = $props();

  // Same partition as NodeRenderer: unslotted children go to `default`, and a
  // child in an unknown slot lands in a bucket nothing renders.
  const buckets = $derived.by(() => {
    const out: Record<string, ResolvedNode[]> = { default: [] };
    for (const child of node.children) (out[child.slot ?? 'default'] ??= []).push(child);
    return out;
  });
  const defaultKids = $derived(buckets.default);
  const headerKids = $derived(buckets.header ?? []);
  const footerKids = $derived(buckets.footer ?? []);
  const sidebarKids = $derived(buckets.sidebar ?? []);
  const topbarKids = $derived(buckets.topbar ?? []);
  const actionsKids = $derived(buckets.actions ?? []);

  const Widget = $derived(components[node.type]);

  const widgetProps = $derived.by(() => {
    const style = specStyle(node.source?.style);
    const p: Record<string, unknown> = {
      id: node.id,
      ...(node.class !== undefined && { class: node.class }),
      ...(style !== undefined && { style }),
      ...node.props,
    };
    const bind = node.bind;
    if (bind) {
      // An explicit `name` wins; otherwise the bound path, as NodeRenderer does.
      if (typeof p.name !== 'string' || p.name.length === 0) p.name = bind.path;
      if (bind.value !== undefined) p[bind.prop] = bind.value;
    }
    for (const key of Object.keys(node.events ?? {})) {
      p[key] = (value: unknown) => runtime.dispatch(node, key, value);
    }
    if (bind) {
      // The contract event writes the bound path, then runs any handler.
      p[bind.event] = (value: unknown) => runtime.dispatch(node, bind.event, value);
      // NodeRenderer also writes the path on input for every bound widget.
      if (bind.event !== 'oninput') {
        p.oninput = (value: unknown) => {
          runtime.state.set(bind.path, value);
          return runtime.dispatch(node, 'oninput', value);
        };
      }
    }
    if (defaultKids.length > 0) p.hasChildren = true;
    return p;
  });
</script>

<!-- Children are unkeyed: `each` expands to copies that share their spec id. -->
{#snippet defaultSnippet()}
  {#each defaultKids as child}<Self node={child} {runtime} {components} fallback={Fallback} />{/each}
{/snippet}
{#snippet headerSnippet()}
  {#each headerKids as child}<Self node={child} {runtime} {components} fallback={Fallback} />{/each}
{/snippet}
{#snippet footerSnippet()}
  {#each footerKids as child}<Self node={child} {runtime} {components} fallback={Fallback} />{/each}
{/snippet}
{#snippet sidebarSnippet()}
  {#each sidebarKids as child}<Self node={child} {runtime} {components} fallback={Fallback} />{/each}
{/snippet}
{#snippet topbarSnippet()}
  {#each topbarKids as child}<Self node={child} {runtime} {components} fallback={Fallback} />{/each}
{/snippet}
{#snippet actionsSnippet()}
  {#each actionsKids as child}<Self node={child} {runtime} {components} fallback={Fallback} />{/each}
{/snippet}

{#if Widget}
  <svelte:boundary>
    <Widget
      {...widgetProps}
      header={headerKids.length > 0 ? headerSnippet : undefined}
      footer={footerKids.length > 0 ? footerSnippet : undefined}
      sidebar={sidebarKids.length > 0 ? sidebarSnippet : undefined}
      topbar={topbarKids.length > 0 ? topbarSnippet : undefined}
      actions={actionsKids.length > 0 ? actionsSnippet : undefined}
      children={defaultKids.length > 0 ? defaultSnippet : undefined}
    />
    {#snippet failed(error)}
      {#if Fallback}<Fallback type={node.type} id={node.id} {error} />{/if}
    {/snippet}
  </svelte:boundary>
{:else if Fallback}
  <Fallback type={node.type} id={node.id} />
{/if}
