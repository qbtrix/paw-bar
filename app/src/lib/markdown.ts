// markdown.ts — Severable markdown core extracted from paw-enterprise's
// src/lib/components/chat/MarkdownRenderer.svelte (segment parser + renderMarkdown).
// Created 2026-07-15 (A3 glass bar). This sanitizes AGENT-AUTHORED markdown on a
// PUBLIC origin, so the DOMPurify allowlist below is copied VERBATIM from the
// source component (ALLOWED_TAGS + ADD_ATTR, exact order) — any drift is an XSS
// hole. tests/markdown.spec.ts pins both arrays so they can't silently change.
//
// CUT from the source (concierge v1 is markdown-only, zero Ripple): the
// ui-spec / Ripple branch, @mention pills, mermaid, and syntax highlighting —
// code fences render as plain <pre> + a copy button (see CodeBlock.svelte).
// KEPT: gfm+breaks marked config, the exact sanitize allowlist, the mobile
// table-wrapper, and the streaming unclosed-GENERIC-fence shimmer mask
// (findUnclosedFenceStart) so an in-flight ```code block doesn't leak raw
// backticks mid-stream. The ui-spec-specific JSON-brace mask is not ported —
// there are no ui-spec fences without Ripple.

import { marked } from 'marked';
import DOMPurify from 'dompurify';

// ── DOMPurify allowlist — copied VERBATIM from MarkdownRenderer.svelte ────────
// Do NOT edit without updating tests/markdown.spec.ts (the drift guard). These
// are the ONLY tags/attributes that survive sanitization of agent markdown.
export const MARKDOWN_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'code', 'pre', 'hr', 'img', 'sup', 'sub', 'span', 'div',
  'input', // GFM task-list checkboxes
] as const;

// colspan/rowspan/scope keep merged-cell tables intact through sanitization —
// without them a stripped colspan silently collapses the table layout.
export const MARKDOWN_ADD_ATTR = [
  'target', 'rel', 'data-channel-id', 'type', 'disabled', 'checked', 'colspan', 'rowspan', 'scope',
] as const;

export type Segment =
  | { type: 'html'; html: string }
  | { type: 'code'; code: string; lang: string }
  | { type: 'code-loading' };

export function renderMarkdown(text: string): string {
  // gfm + breaks: turn on GitHub Flavored Markdown extras (tables,
  // strikethrough, autolinks, task lists) and treat single newlines as
  // <br> so multi-line replies look the way users typed them.
  const raw = marked.parse(text, {
    async: false,
    gfm: true,
    breaks: true,
  }) as string;
  const sanitized = DOMPurify.sanitize(raw, {
    ADD_ATTR: [...MARKDOWN_ADD_ATTR],
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
    result.push({ type: 'code', lang, code });
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
