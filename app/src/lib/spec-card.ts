// lib/spec-card.ts — recognise and bound a Ripple spec sent as a card.
// Created 2026-09-27 when the spec renderer was wired into the thread.
//
// Until the typed part stream exists, a generated UI arrives the way cards do:
// a ```pawbar-card fence. A fence whose JSON has a `ui` object is a Ripple spec
// ({ ui, state? }); anything else is a legacy card for lib/cards.ts. The spec
// is agent-written and drawn on a customer's page, so it is bounded before any
// of it renders: the fence's size, the node count and the nesting depth. A spec
// over any bound, or with a malformed tree, renders the quiet "Card
// unavailable" line instead. Which types may appear is not checked here: the
// renderer draws only the types in components/spec-widgets/registry.ts and a
// fallback for anything else. Only `ui` and `state` are kept: a spec's
// `theme` is dropped, because the bar follows the site owner's styling.

import type { UINode, UISpec } from '@ripple-ui/core/headless/slim';

export const MAX_SPEC_CHARS = 32_000;
export const MAX_SPEC_NODES = 80;
export const MAX_SPEC_DEPTH = 8;

export type SpecCardResult =
  | { kind: 'spec'; spec: UISpec }
  | { kind: 'invalid'; reason: string }
  | { kind: 'legacy' };

/** Count nodes and check depth; null when within bounds, else the reason. */
function checkTree(root: unknown): string | null {
  let nodes = 0;
  const walk = (node: unknown, depth: number): string | null => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return 'a node is not an object';
    if (typeof (node as { type?: unknown }).type !== 'string') return 'a node has no type';
    if (++nodes > MAX_SPEC_NODES) return `more than ${MAX_SPEC_NODES} nodes`;
    if (depth > MAX_SPEC_DEPTH) return `nested deeper than ${MAX_SPEC_DEPTH}`;
    for (const key of ['children', 'else_children'] as const) {
      const kids = (node as Record<string, unknown>)[key];
      if (kids === undefined) continue;
      if (!Array.isArray(kids)) return `${key} is not a list`;
      for (const kid of kids) {
        const err = walk(kid, depth + 1);
        if (err) return err;
      }
    }
    return null;
  };
  return walk(root, 1);
}

/** Classify a `pawbar-card` fence body. Never throws. */
export function parseSpecCard(json: string): SpecCardResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { kind: 'legacy' }; // lib/cards.ts gives it the fallback
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('ui' in raw)) return { kind: 'legacy' };
  if (json.length > MAX_SPEC_CHARS) return { kind: 'invalid', reason: `longer than ${MAX_SPEC_CHARS} characters` };
  const obj = raw as Record<string, unknown>;
  const err = checkTree(obj.ui);
  if (err) return { kind: 'invalid', reason: err };
  const state = obj.state;
  if (state !== undefined && (!state || typeof state !== 'object' || Array.isArray(state))) {
    return { kind: 'invalid', reason: 'state is not an object' };
  }
  return { kind: 'spec', spec: { ui: obj.ui as UINode, state: state as Record<string, unknown> | undefined } as UISpec };
}
