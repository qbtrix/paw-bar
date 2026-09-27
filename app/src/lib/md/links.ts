// lib/md/links.ts — which hrefs a reply link may keep.
// Created 2026-09-27: moved out of lib/markdown.ts unchanged when the markdown
// path stopped producing HTML. The rules and their history (2026-09-26, the
// reply-links and security-review notes) are the same:
//   • Absolute hrefs keep only http:, https:, mailto: and tel:.
//   • A relative href resolves against the host page origin (setLinkBase, called
//     from main.ts with config.parentOrigin) and is kept only if it stays on that
//     origin, which is what rejects `//evil`, `/\evil` and `\\evil`.
//   • A bare `#frag`, `?query` or empty href is dropped: it points at the
//     widget's own document, and resolving it would silently link the host's
//     home page.
// A link whose href is dropped still renders, as an <a> with no href.

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

// Host page origin that site-relative hrefs resolve against. null means
// "unknown", and then relative hrefs are dropped.
let linkBase: string | null = null;

/** Accept only an exact http(s) ORIGIN (no path, no '*'); anything else clears
 *  the base so relative links fall back to being dropped. */
export function setLinkBase(origin: string | null | undefined): void {
  linkBase = null;
  if (!origin) return;
  try {
    // Normalise (so `https://shop.example:443` and a trailing `/` are fine),
    // but refuse anything carrying a path, query, hash or credentials: that is
    // not an origin, and guessing which part was meant is worse than dropping.
    const u = new URL(origin);
    const bare =
      u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password && !/[?#]/.test(origin);
    if ((u.protocol === 'https:' || u.protocol === 'http:') && bare) linkBase = u.origin;
  } catch {
    /* not a URL — leave the base unset */
  }
}

/** Return the href to keep, or null to drop it. */
export function safeHref(href: string): string | null {
  let absolute: URL | null = null;
  try {
    absolute = new URL(href);
  } catch {
    /* relative — handled below */
  }
  if (absolute) return SAFE_LINK_PROTOCOLS.has(absolute.protocol) ? href : null;
  if (!linkBase) return null;
  // The URL parser strips leading C0 controls/spaces, so this regex does too.
  if (/^[\x00-\x20]*(?:[#?]|$)/.test(href)) return null;
  try {
    const resolved = new URL(href, linkBase + '/');
    return resolved.origin === linkBase ? resolved.href : null;
  } catch {
    return null;
  }
}
