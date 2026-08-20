// lib/preview-tokens.ts — the owner preview's live-restyle channel.
//
// Created 2026-08-20. Extracted from main.ts so the gate below is unit-testable:
// main.ts runs the whole app on import, and a security check nobody can exercise
// is a security check nobody has watched work.
//
// WHAT THIS OPENS. The appearance editor renders a draft to --pawbar-* tokens
// server-side and posts the map here, so the owner preview repaints as they
// edit. That means accepting styling instructions from another window, which is
// only ever acceptable under both of these:
//
//   1. `preview` — true ONLY for the owner preview frame (D5). A public embed
//      never installs this at all.
//   2. a known `parentOrigin`, matched exactly against event.origin.
//
// BOTH ARE REQUIRED, and the second FAILS CLOSED. An earlier cut of this read
// `if (parentOrigin && event.origin !== parentOrigin) return`, which skips the
// origin check entirely when parentOrigin is empty — and empty is a state that
// really happens: the backend's _safe_parent_origin returns "" whenever the
// dashboard origin fails sanitization, and the dev config falls back to a
// referrer that may not be there. In that state any window holding a handle to
// this one could set arbitrary CSS custom properties on the widget, including
// url() values that fetch. Caught by a push-time security review.
//
// So: no parentOrigin, no listener. Refusing to install is the honest failure —
// the preview simply does not repaint, which is visible, rather than quietly
// accepting instructions from anyone.

import { applyTokens } from './tokens';

export interface PreviewTokenChannel {
  /** True only in the owner preview frame. */
  preview: boolean;
  /** The exact origin allowed to drive the preview. "" means refuse. */
  parentOrigin: string;
  /** Resolves the widget root at message time — Svelte may not have drawn it yet. */
  getRoot: () => HTMLElement | null;
}

/**
 * Install the listener, if and only if both gates pass.
 *
 * Returns a teardown function, or null when nothing was installed — the null
 * is what the tests assert on, because "did not install" is the security
 * property, not "installed and then ignored things".
 */
export function installPreviewTokenListener(ch: PreviewTokenChannel): (() => void) | null {
  if (!ch.preview) return null;
  if (!ch.parentOrigin) return null;

  const onMessage = (event: MessageEvent): void => {
    // Exact match, no prefix or suffix comparison: "https://app.example.com" and
    // "https://app.example.com.evil.test" share a prefix.
    if (event.origin !== ch.parentOrigin) return;
    const data = event.data as { type?: unknown; tokens?: unknown } | null;
    if (!data || data.type !== 'pawbar:preview-tokens') return;
    const tokens = data.tokens;
    // Arrays are objects; a map is what applyTokens iterates.
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return;
    const root = ch.getRoot();
    if (root) applyTokens(root, tokens as Record<string, string>);
  };

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
