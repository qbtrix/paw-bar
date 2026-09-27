<!--
  SpecRenderer.svelte — draws a Ripple spec with components the host passes in.
  Created 2026-09-27.

  The engine is @ripple-ui/core/headless: it resolves expressions, `show`,
  `if` and `each`, holds the spec's state, and runs actions. This file and
  SpecNode.svelte only draw the resolved tree, so no Ripple widget, stylesheet
  or schema is bundled. Host actions (`emit`, `api`, `invoke_tool`, ...) go to
  `onEvent` with Ripple's own callback contract.

  Styling, from least to most authoritative:
    1. `theme` (the prop, else the spec's `theme`) becomes CSS variables on the
       root, named as Ripple names them (`--primary`, `--radius`,
       `--ripple-font-sans`, ...), and `mode` becomes `data-mode`. Filtered,
       because a spec is agent-written.
    2. Each node's `class` and filtered `style` pass to its component.
    3. The host's `class` and `style` on the root are trusted and applied last,
       so the site's own styling wins over the spec's theme.

  Initial state is the `state` prop, else the spec's `state`, read once. A new
  `spec` swaps the tree and keeps the state, which is what a redraft wants.
-->
<script lang="ts">
  import { onDestroy, untrack, type Component } from 'svelte';
  import { createHeadlessRuntime, type OnEventCallback, type UINode, type UISpec } from '@ripple-ui/core/headless';
  import SpecNode from './SpecNode.svelte';
  import { themeStyle, type SpecTheme } from './style';
  import type { SpecComponents, SpecFallbackProps } from './types';

  interface Props {
    /** A full spec (`{ ui, state?, theme? }`), one root node, or a list of roots. */
    spec: UISpec | UINode | UINode[];
    /** The components this renderer can draw, keyed by spec `type`. */
    components: SpecComponents;
    /** Initial state. Overrides the spec's own `state`. */
    state?: Record<string, unknown>;
    /** Host data bag, readable in expressions as `data.*`. */
    data?: Record<string, unknown>;
    /** Theme. Overrides the spec's own `theme`. */
    theme?: SpecTheme;
    /** Receives host-delegated actions. */
    onEvent?: OnEventCallback;
    /** Drawn for a type with no component, and for a component that throws. */
    fallback?: Component<SpecFallbackProps>;
    /** Called for a type with no component. Return `false` to draw nothing at all. */
    onUnknownWidget?: (type: string, node: UINode) => boolean | void;
    /** Host class on the root. */
    class?: string;
    /** Host inline style on the root. Trusted; applied after the theme. */
    style?: string;
  }

  // Locals renamed: a binding called `state` would turn `$state` into a store
  // subscription instead of the rune, and `class` is reserved.
  let {
    spec,
    components,
    state: initialState,
    data,
    theme,
    onEvent,
    fallback,
    onUnknownWidget,
    class: hostClass,
    style: hostStyle,
  }: Props = $props();

  type Split = { root: UINode | UINode[]; initial?: Record<string, unknown>; theme?: SpecTheme };

  function split(s: UISpec | UINode | UINode[]): Split {
    if (!Array.isArray(s) && 'ui' in s && s.ui) {
      return { root: s.ui as UINode, initial: s.state, theme: s.theme as SpecTheme | undefined };
    }
    return { root: s as UINode | UINode[] };
  }

  const runtime = untrack(() => {
    const { root, initial } = split(spec);
    return createHeadlessRuntime({
      spec: root,
      state: initialState ?? initial ?? {},
      data: data ?? {},
      // Read the props at call time so a host can swap its callbacks.
      onEvent: (event) => onEvent?.(event),
      isKnownWidget: (type) => type in components,
      // The runtime's default warns on every unknown node; stay quiet instead.
      onUnknownWidget: (type, node) => (onUnknownWidget ? onUnknownWidget(type, node) : true),
    });
  });

  let tree = $state.raw(runtime.tree);
  onDestroy(runtime.subscribe((next) => (tree = next)));

  // setSpec and setData only invalidate the memo and notify no one, so read the
  // tree back here. The first run re-resolves the same spec, which is cheap.
  $effect(() => {
    const { root } = split(spec);
    untrack(() => {
      runtime.setSpec(root);
      tree = runtime.tree;
    });
  });
  $effect(() => {
    const next = data ?? {};
    untrack(() => {
      runtime.setData(next);
      tree = runtime.tree;
    });
  });

  const activeTheme = $derived(theme ?? split(spec).theme);
  const rootStyle = $derived([themeStyle(activeTheme), hostStyle].filter(Boolean).join('; ') || undefined);
</script>

<div class={['pawbar-spec', hostClass]} style={rootStyle} data-mode={activeTheme?.mode}>
  {#each tree.nodes as node}
    <SpecNode {node} {runtime} {components} {fallback} />
  {/each}
</div>
