// lib/md/types.ts — the markdown tree the parser produces and MdBlocks renders.
// Created 2026-09-27 with the native markdown renderer.
//
// A reply is parsed into these plain objects and drawn with Svelte elements and
// text bindings; nothing in the path builds an HTML string. So the node kinds
// below ARE the allowlist: a reply can only ever produce these elements
// (p, br, strong, em, del, code, sup, sub, a, ul, ol, li, h1-h6, blockquote,
// table and its parts, hr, pre, and a disabled task checkbox).

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong' | 'em' | 'del' | 'sup' | 'sub'; c: Inline[] }
  | { t: 'code'; v: string }
  /** href is already vetted by links.safeHref; null renders an <a> without one. */
  | { t: 'link'; href: string | null; c: Inline[] }
  | { t: 'br' };

export type Align = 'left' | 'center' | 'right' | null;

export interface ListItem {
  /** null: not a task item. true/false: a task item, checked or not. */
  task: boolean | null;
  c: Block[];
}

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  /** loose lists wrap item paragraphs in <p>; tight lists render them bare. */
  | { t: 'list'; ordered: boolean; start: number; loose: boolean; items: ListItem[] }
  | { t: 'quote'; c: Block[] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'pre'; v: string }
  | { t: 'hr' };
