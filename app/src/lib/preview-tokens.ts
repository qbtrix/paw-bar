// lib/preview-tokens.ts — the owner preview's live channels.
//
// Kept out of main.ts so the gate below is unit-testable: main.ts runs the whole
// app on import, and a security check nobody can exercise is a security check
// nobody has watched work.
//
// WHAT THIS OPENS. The appearance editor posts its draft here so the owner
// preview repaints as they edit. Two messages:
//   - {pawbar:preview-config, config} — the draft's owner settings (tokens,
//     tokensDark, scheme, launcher, side, barSize, logo, launcherLabel,
//     disclosure, privacyHref, consentRequired, voice, poweredBy, expandable),
//     normalised by config.ts readOwnerConfig exactly like the boot config.
//     Only the keys the message carries are applied (installPreviewConfigListener).
//   - {pawbar:preview-tokens, tokens, tokensDark} — tokens only, painted
//     straight onto the root. Kept for editors that predate preview-config.
// That means accepting instructions from another window, which is only ever
// acceptable under both of these:
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
//
// LIGHT AND DARK. A message carries `tokens` and, optionally, `tokensDark`.
// The dark set goes on top while the bar reads dark, which the frame marks on
// the root as data-pawbar-scheme. The last pair received is kept and re-applied
// whenever that attribute changes, so the preview follows a scheme flip without
// the editor re-posting, and the frame's own theme pass (which re-runs on the
// same flip) cannot leave the saved values showing over the draft.

import { applyTokens } from './tokens';
import { readOwnerConfig, type OwnerConfig } from '../config';

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

  let last: { tokens: Record<string, string>; tokensDark: Record<string, string> } | null = null;
  let observed: HTMLElement | null = null;
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => paint()) : null;

  function paint(): void {
    const root = ch.getRoot();
    if (!root || !last) return;
    const scheme = root.getAttribute('data-pawbar-scheme') === 'dark' ? 'dark' : 'light';
    applyTokens(root, last.tokens, last.tokensDark, scheme);
    if (observer && observed !== root) {
      observer.disconnect();
      observer.observe(root, { attributes: true, attributeFilter: ['data-pawbar-scheme'] });
      observed = root;
    }
  }

  const onMessage = (event: MessageEvent): void => {
    // Exact match, no prefix or suffix comparison: "https://app.example.com" and
    // "https://app.example.com.evil.test" share a prefix.
    if (event.origin !== ch.parentOrigin) return;
    const data = event.data as { type?: unknown; tokens?: unknown; tokensDark?: unknown } | null;
    if (!data || data.type !== 'pawbar:preview-tokens') return;
    const tokens = data.tokens;
    // Arrays are objects; a map is what applyTokens iterates.
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return;
    // Optional: an editor that predates the dark set sends none.
    const dark = data.tokensDark;
    const tokensDark = dark && typeof dark === 'object' && !Array.isArray(dark) ? (dark as Record<string, string>) : {};
    last = { tokens: tokens as Record<string, string>, tokensDark };
    paint();
  };

  window.addEventListener('message', onMessage);
  return () => {
    window.removeEventListener('message', onMessage);
    observer?.disconnect();
  };
}

export interface PreviewConfigChannel {
  /** True only in the owner preview frame. */
  preview: boolean;
  /** The exact origin allowed to drive the preview. "" means refuse. */
  parentOrigin: string;
  /** Receives the normalised settings the message carried. */
  apply: (patch: Partial<OwnerConfig>) => void;
}

/**
 * The live owner-settings channel. Same two gates as the token channel, and the
 * same null when it does not install. The payload is read as `data.config`;
 * every key goes through readOwnerConfig, so a draft the server has not
 * normalised still cannot put a script URL in the logo or a non-map in tokens.
 */
export function installPreviewConfigListener(ch: PreviewConfigChannel): (() => void) | null {
  if (!ch.preview) return null;
  if (!ch.parentOrigin) return null;

  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== ch.parentOrigin) return;
    const data = event.data as { type?: unknown; config?: unknown } | null;
    if (!data || data.type !== 'pawbar:preview-config') return;
    const raw = data.config;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const all = readOwnerConfig(raw as Partial<PawBarBootConfig>);
    const patch: Partial<OwnerConfig> = {};
    for (const key of Object.keys(all) as (keyof OwnerConfig)[]) {
      if (key in raw) (patch as Record<string, unknown>)[key] = all[key];
    }
    ch.apply(patch);
  };

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
