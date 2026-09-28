// lib/tokens.ts — apply the owner's --pawbar-* overrides to the widget root.
//
// Created 2026-08-20, extracted from main.ts when the owner preview gained live
// restyling. It moved out for one reason: main.ts runs the whole app on import,
// so nothing in it can be unit-tested, and the clear-then-apply cycle below is
// exactly the kind of logic that fails silently.
//
// 2026-09-27 (old shell removed): the only caller now is lib/preview-tokens.ts
// (owner preview live restyling). main.ts points it at the new bar's
// .frame-wrap, the element PawBarFrame also writes its inline theme vars on.
// The old tokens.css and its .pawbar-root no longer exist.
//
// WHERE THESE LAND MATTERS. They must be set on the element that declares the
// --pawbar-* values, never on an ancestor: a declaration on an element always
// beats a value inherited from its parent. Setting them on the parent is what
// made every owner override silently vanish for months under the old shell.
// tests/tokens-apply.spec.ts covers the apply/retract cycle below.
//
// A dark set rides with the light one: on 'dark' it goes over `tokens`, on
// 'light' it is left out, and the retraction then removes any key only the dark
// set carried, so the light value (or the stylesheet default) comes back.

/** Keys set by the LAST call, so the next one can retract them. */
let appliedTokenKeys: string[] = [];

/**
 * Apply a --pawbar-* map to the widget root, replacing whatever the previous
 * call applied.
 *
 * The retraction is the whole reason this keeps state. The owner preview calls
 * this again on every edit, and a token the owner CLEARS is simply absent from
 * the new map — so without removing what we set last time, the old inline
 * declaration would stay and pin the bar to a value the appearance no longer
 * carries. The stylesheet default could never win it back, and the owner would
 * be looking at a colour that no longer exists anywhere in their settings.
 *
 * Only our own keys are removed, never the whole inline style: the root may
 * carry properties this function did not put there.
 */
export function applyTokens(
  root: HTMLElement,
  tokens: Record<string, string>,
  tokensDark: Record<string, string> = {},
  scheme: 'light' | 'dark' = 'light',
): void {
  for (const key of appliedTokenKeys) root.style.removeProperty(key);
  appliedTokenKeys = [];
  const merged = scheme === 'dark' ? { ...(tokens ?? {}), ...(tokensDark ?? {}) } : (tokens ?? {});
  for (const [rawKey, rawValue] of Object.entries(merged)) {
    const key = rawKey.startsWith('--') ? rawKey : `--pawbar-${rawKey.replace(/^pawbar-/, '')}`;
    if (typeof rawValue === 'string') {
      root.style.setProperty(key, rawValue);
      if (!appliedTokenKeys.includes(key)) appliedTokenKeys.push(key);
    }
  }
}

/** Test seam: forget what was applied, so a suite starts from a clean slate. */
export function resetAppliedTokens(): void {
  appliedTokenKeys = [];
}
