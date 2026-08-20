// scheme.ts — which way round the widget reads: light or dark.
// Created 2026-08-19.
//
// The widget shipped dark-only, which meant a light storefront got a dark slab
// bolted to the corner of it (the captain's report: "i see dark mode only").
// It cannot answer this for itself — it is a cross-origin iframe and can see
// nothing of the page around it — so the LOADER, which runs in the host
// document, resolves the host page's scheme and passes it on the frame URL.
// See hostScheme() in loader/src/loader.ts for how it reads the page.
//
// Resolved in JS rather than in CSS on purpose. The alternative is a
// `[data-scheme='light']` block plus a `@media (prefers-color-scheme: light)`
// copy of the same block for the auto case, and two copies of a palette drift
// apart. Resolving here means the stylesheet carries ONE light block and this
// file is the only place the precedence lives.

export type Scheme = 'light' | 'dark';
export type SchemeSetting = Scheme | 'auto';

export interface SchemeInputs {
  /** The owner's explicit choice, when the appearance model has shipped one. */
  owner?: string;
  /** What the loader read off the host page: 'l' | 'd' (frame URL `?s=`). */
  host?: string | null;
  /** The visitor's OS preference. */
  prefersDark?: boolean;
}

/** Normalize whatever the boot config carried into a setting we understand. */
export function readSetting(value: unknown): SchemeSetting {
  return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto';
}

/**
 * The cascade, most specific first:
 *
 *   1. The OWNER's setting. They know their brand; when they have said
 *      "always light", a visitor's midnight OS does not get to override it.
 *   2. The HOST PAGE, as the loader read it. This is the "match the site"
 *      case, and it is the default because a support widget belongs to the
 *      page it is bolted to more than it belongs to the desktop behind it.
 *   3. The VISITOR's OS preference, when the page said nothing either way —
 *      which is what the loader falls back to as well, so this mostly matters
 *      in a standalone dev frame with no loader in front of it.
 *   4. Dark, the palette this widget has always shipped.
 *
 * Owner TOKENS are a separate, higher layer still: they land as inline custom
 * properties on the root and beat every stylesheet rule, whatever this returns.
 */
export function resolveScheme({ owner, host, prefersDark }: SchemeInputs): Scheme {
  const setting = readSetting(owner);
  if (setting !== 'auto') return setting;
  if (host === 'l' || host === 'light') return 'light';
  if (host === 'd' || host === 'dark') return 'dark';
  return prefersDark === false ? 'light' : 'dark';
}

/** The loader's `?s=` off the frame URL. Absent in a standalone dev page. */
export function hostSchemeFromUrl(search: string): string | null {
  try {
    return new URLSearchParams(search).get('s');
  } catch {
    return null;
  }
}
