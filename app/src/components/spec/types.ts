// components/spec/types.ts — public types for the spec renderer.
// Created 2026-09-27 with the spec renderer.

import type { Component } from 'svelte';

/**
 * The components a spec can draw, keyed by spec `type`. Each receives the
 * props Ripple's NodeRenderer gives a widget: resolved props, `id`, `class`,
 * `style` (filtered, as a string), `name` and the bound value for a bound
 * node, `on*` handlers, `hasChildren`, and one snippet per non-empty slot
 * (`children`, `header`, `footer`, `sidebar`, `topbar`, `actions`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SpecComponents = Record<string, Component<any>>;

/** Props given to the fallback component. */
export interface SpecFallbackProps {
  /** The spec type that could not be drawn. */
  type: string;
  /** The node's id, when the spec gave one. */
  id?: string;
  /** Set when the component threw while rendering; absent for an unknown type. */
  error?: unknown;
}
