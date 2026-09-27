// tests/fixtures/md-oracle.ts — the markdown path this app shipped until
// 2026-09-27 (marked gfm+breaks, then a private DOMPurify with the link and
// input hooks, tables wrapped as DOM nodes), kept verbatim as a TEST ORACLE.
// The native renderer (lib/md/) replaced it in the bundle; tests/md-parity.spec
// renders the same input through both and compares the DOM. marked and dompurify
// are devDependencies for this file only. Do not import it from src/.

import { Marked } from 'marked';
import DOMPurify from 'dompurify';

// ── DOMPurify allowlist — this app's own, pinned by tests/markdown.spec.ts ───
// Do NOT edit without updating that pin. These are the ONLY tags/attributes
// that survive sanitization of agent markdown.
export const MARKDOWN_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'code', 'pre', 'hr', 'sup', 'sub', 'span', 'div',
  'input', // GFM task-list checkboxes
] as const;

// Exactly what marked emits on this path (fences are intercepted upstream):
// href on links (title dropped 2026-09-26: a tooltip adds nothing here and it
// was the attribute the C1 payload rode in), align on table cells, start on <ol>, type/disabled/
// checked on task-list checkboxes. colspan/rowspan/scope keep merged-cell
// tables intact. target/rel are deliberately absent — the link hook is their
// only writer.
export const MARKDOWN_ALLOWED_ATTR = [
  'href', 'align', 'start', 'type', 'disabled', 'checked', 'colspan', 'rowspan', 'scope',
] as const;

// data-* and aria-* are allowed by DOMPurify's defaults even under an explicit
// ALLOWED_ATTR. Nothing marked emits here needs either, and aria-label /
// aria-hidden let a reply say one thing to a screen reader and show another.
export const MARKDOWN_PURIFY_FLAGS = { ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false } as const;

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

// Host page origin that site-relative hrefs resolve against. Set once at boot
// (main.ts → setLinkBase(config.parentOrigin)); null means "unknown", and then
// relative hrefs are dropped as before.
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

/** Return the href to keep, or null to drop it. Absolute hrefs must use an
 *  allowlisted scheme. A relative href is resolved against linkBase and kept
 *  only if it lands on that SAME origin — which is what rejects
 *  protocol-relative `//evil`, and the `/\evil` / `\\evil` spellings browsers
 *  also read as protocol-relative, without having to enumerate them. */
function safeHref(href: string): string | null {
  let absolute: URL | null = null;
  try {
    absolute = new URL(href);
  } catch {
    /* relative — handled below */
  }
  if (absolute) return SAFE_LINK_PROTOCOLS.has(absolute.protocol) ? href : null;
  if (!linkBase) return null;
  // A bare fragment/query (`#faq`, `?q=1`) or empty href refers to the WIDGET's
  // own document; resolving it would silently point at the host's home page.
  // The URL parser strips leading C0 controls/spaces, so this regex does too.
  if (/^[\x00-\x20]*(?:[#?]|$)/.test(href)) return null;
  try {
    const resolved = new URL(href, linkBase + '/');
    return resolved.origin === linkBase ? resolved.href : null;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Private marked instance: images render as escaped alt text, never <img>.
const markdown = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  renderer: {
    image({ text }) {
      return escapeHtml(text);
    },
  },
});

let purifier: ReturnType<typeof DOMPurify> | null = null;

// Private DOMPurify instance (created lazily, once a window exists) carrying
// the link hook, so no other sanitize call in the bundle inherits it.
function getPurifier(): ReturnType<typeof DOMPurify> {
  if (purifier) return purifier;
  const p = DOMPurify(window);
  p.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'INPUT') {
      // Only the GFM task-list checkbox is legitimate here. Any other input
      // (text, password, submit, ...) is a fake form field a reply could use
      // to phish the visitor, so it goes; the checkbox is forced read-only.
      if ((node.getAttribute('type') ?? '').toLowerCase() !== 'checkbox') node.remove();
      else node.setAttribute('disabled', '');
      return;
    }
    if (node.nodeName !== 'A') return;
    const href = node.getAttribute('href');
    if (href !== null) {
      const kept = safeHref(href);
      if (kept === null) node.removeAttribute('href');
      else if (kept !== href) node.setAttribute('href', kept);
    }
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  });
  purifier = p;
  return p;
}

export type Segment =
  | { type: 'html'; html: string }
  | { type: 'code'; code: string; lang: string }
  | { type: 'card'; json: string }
  | { type: 'code-loading' };

/** Fence language that carries an agent-authored action card. Intercepted
 *  BEFORE markdown render and parsed as JSON into native glass components
 *  (Svelte props only) — it never touches the DOMPurify/markdown path. */
export const CARD_FENCE_LANG = 'pawbar-card';

export function renderMarkdown(text: string): string {
  // gfm + breaks: turn on GitHub Flavored Markdown extras (tables,
  // strikethrough, autolinks, task lists) and treat single newlines as
  // <br> so multi-line replies look the way users typed them.
  const raw = markdown.parse(text) as string;
  const fragment = getPurifier().sanitize(raw, {
    ...MARKDOWN_PURIFY_FLAGS,
    ALLOWED_ATTR: [...MARKDOWN_ALLOWED_ATTR],
    ALLOWED_TAGS: [...MARKDOWN_ALLOWED_TAGS],
    RETURN_DOM_FRAGMENT: true,
  });
  // Wrap tables in a scrollable container for mobile — in the DOM, NEVER with
  // a string replace on sanitized output (see the security-review note above).
  for (const table of fragment.querySelectorAll('table')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pawbar-table-wrapper';
    table.replaceWith(wrapper);
    wrapper.append(table);
  }
  const out = document.createElement('div');
  out.append(fragment);
  return out.innerHTML;
}
