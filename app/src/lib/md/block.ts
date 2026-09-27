// lib/md/block.ts — block markdown to Block nodes.
// Created 2026-09-27 with the native markdown renderer.
//
// Line-based, following marked's gfm behaviour for what model replies contain:
// ATX (# Title) and setext (Title / ===) headings; paragraphs; thematic breaks;
// blockquotes with lazy continuation; bullet (-, *, +) and ordered (1. / 1))
// lists, nested by indentation, tight or loose, with task items, and able to
// interrupt a paragraph (an ordered list only when it starts at 1); GFM tables
// with alignment, escaped pipes and rows without edge pipes; ~~~ fences and
// indented code as plain <pre>. Triple-backtick fences never reach here:
// lib/markdown.ts splits them out first for CodeBlock and the card layer.
// Reference-style links and HTML blocks are not special: their text renders
// as inline content.

import { parseInline } from './inline';
import type { Align, Block, ListItem } from './types';

const BLANK = /^[ \t]*$/;
const HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const FENCE = /^ {0,3}(~{3,}|`{3,})(.*)$/;
const BULLET = /^( {0,3})([-+*])([ \t]+|$)(.*)$/;
const ORDERED = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)(.*)$/;
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const indentOf = (l: string) => /^ */.exec(l)![0].length;

interface Marker {
  ordered: boolean;
  /** Bullet char, or the ordered delimiter (`.` / `)`). */
  kind: string;
  start: number;
  /** Column where the item's content starts. */
  contentIndent: number;
  first: string;
}

function marker(line: string): Marker | null {
  const b = BULLET.exec(line);
  if (b && !HR.test(line)) {
    const [, ind, ch, gap, rest] = b;
    const width = gap.length > 4 || !rest ? 1 : gap.length;
    return { ordered: false, kind: ch, start: 1, contentIndent: ind.length + 1 + width, first: rest };
  }
  const o = ORDERED.exec(line);
  if (o) {
    const [, ind, num, delim, gap, rest] = o;
    const width = gap.length > 4 || !rest ? 1 : gap.length;
    return { ordered: true, kind: delim, start: parseInt(num, 10), contentIndent: ind.length + num.length + 1 + width, first: rest };
  }
  return null;
}

/** A line that starts some block other than a paragraph continuation. */
function startsBlock(line: string): boolean {
  return HR.test(line) || ATX.test(line) || QUOTE.test(line) || FENCE.test(line) || marker(line) !== null;
}

/** Split a table row on unescaped pipes, dropping the edge pipes. */
function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function alignOf(cell: string): Align {
  const l = cell.startsWith(':');
  const r = cell.endsWith(':');
  return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
}

class BlockParser {
  private out: Block[] = [];
  private para: string[] | null = null;
  private i = 0;

  constructor(private lines: string[]) {}

  run(): Block[] {
    const lines = this.lines;
    while (this.i < lines.length) {
      const line = lines[this.i];
      if (BLANK.test(line)) {
        this.flush();
        this.i += 1;
      } else if (!this.para && indentOf(line) >= 4) {
        this.indentedCode();
      } else if (this.para && SETEXT.test(line)) {
        const level = line.trim().startsWith('=') ? 1 : 2;
        this.out.push({ t: 'h', level, c: parseInline(this.para.join('\n')) });
        this.para = null;
        this.i += 1;
      } else if (HR.test(line)) {
        this.flush();
        this.out.push({ t: 'hr' });
        this.i += 1;
      } else if (ATX.test(line)) {
        this.flush();
        const [, hashes, text = ''] = ATX.exec(line)!;
        this.out.push({ t: 'h', level: hashes.length as 1, c: parseInline(text.replace(/^#+$/, '').trim()) });
        this.i += 1;
      } else if (FENCE.test(line)) {
        this.flush();
        this.fence();
      } else if (QUOTE.test(line)) {
        this.flush();
        this.quote();
      } else if (this.listCanStart(line)) {
        this.flush();
        this.list();
      } else if (this.tableStarts()) {
        this.flush();
        this.table();
      } else {
        (this.para ??= []).push(line.trim());
        this.i += 1;
      }
    }
    this.flush();
    return this.out;
  }

  private flush() {
    if (!this.para) return;
    this.out.push({ t: 'p', c: parseInline(this.para.join('\n')) });
    this.para = null;
  }

  private listCanStart(line: string): boolean {
    const m = marker(line);
    if (!m) return false;
    // Interrupting a paragraph: not with an empty item, and an ordered list
    // only when it starts at 1 (so "in 2024. Then" stays prose).
    if (this.para) return m.first.trim() !== '' && (!m.ordered || m.start === 1);
    return true;
  }

  private tableStarts(): boolean {
    const head = this.lines[this.i];
    const delim = this.lines[this.i + 1];
    if (!head.includes('|') || delim === undefined || !TABLE_DELIM.test(delim)) return false;
    return cells(head).length === cells(delim).length;
  }

  private table() {
    const head = cells(this.lines[this.i]);
    const align = cells(this.lines[this.i + 1]).map(alignOf);
    const rows: string[][] = [];
    this.i += 2;
    while (this.i < this.lines.length) {
      const line = this.lines[this.i];
      if (BLANK.test(line) || startsBlock(line)) break;
      rows.push(cells(line));
      this.i += 1;
    }
    const width = head.length;
    const fit = (r: string[]) => Array.from({ length: width }, (_, k) => parseInline(r[k] ?? ''));
    this.out.push({ t: 'table', align, head: fit(head), rows: rows.map(fit) });
  }

  private indentedCode() {
    const body: string[] = [];
    while (this.i < this.lines.length) {
      const line = this.lines[this.i];
      if (!BLANK.test(line) && indentOf(line) < 4) break;
      body.push(line.slice(Math.min(4, indentOf(line))));
      this.i += 1;
    }
    while (body.length && BLANK.test(body[body.length - 1])) body.pop();
    this.out.push({ t: 'pre', v: body.join('\n') + '\n' });
  }

  private fence() {
    const [, open] = FENCE.exec(this.lines[this.i])!;
    const indent = indentOf(this.lines[this.i]);
    const body: string[] = [];
    this.i += 1;
    while (this.i < this.lines.length) {
      const line = this.lines[this.i];
      const close = FENCE.exec(line);
      this.i += 1;
      if (close && close[1][0] === open[0] && close[1].length >= open.length && !close[2].trim()) break;
      body.push(line.slice(Math.min(indent, indentOf(line))));
    }
    this.out.push({ t: 'pre', v: body.length ? body.join('\n') + '\n' : '' });
  }

  private quote() {
    const inner: string[] = [];
    let lastBlank = false;
    while (this.i < this.lines.length) {
      const line = this.lines[this.i];
      const q = QUOTE.exec(line);
      if (q) {
        inner.push(q[1]);
        lastBlank = BLANK.test(q[1]);
      } else if (!BLANK.test(line) && !lastBlank && !startsBlock(line)) {
        inner.push(line); // lazy continuation of the quoted paragraph
      } else break;
      this.i += 1;
    }
    this.out.push({ t: 'quote', c: parseBlocks(inner.join('\n')) });
  }

  private list() {
    const first = marker(this.lines[this.i])!;
    const items: ListItem[] = [];
    let loose = false;
    while (this.i < this.lines.length) {
      const m = marker(this.lines[this.i]);
      if (!m || m.ordered !== first.ordered || m.kind !== first.kind) break;
      const body = [m.first];
      this.i += 1;
      let sawBlank = false;
      while (this.i < this.lines.length) {
        const line = this.lines[this.i];
        if (BLANK.test(line)) {
          body.push('');
          sawBlank = true;
        } else if (indentOf(line) >= m.contentIndent) {
          body.push(line.slice(m.contentIndent));
          sawBlank = false;
        } else if (!sawBlank && !startsBlock(line)) {
          body.push(line.trim()); // lazy continuation
        } else break;
        this.i += 1;
      }
      let trailing = 0;
      while (body.length > 1 && body[body.length - 1] === '') {
        body.pop();
        trailing += 1;
      }
      // Loose: a blank line between two items, or between two blocks of one item.
      const next = this.lines[this.i];
      const nextItem = next !== undefined ? marker(next) : null;
      if (trailing && nextItem && nextItem.ordered === first.ordered && nextItem.kind === first.kind) loose = true;
      for (let k = 1; k < body.length; k++) {
        if (body[k - 1] === '' && body[k] !== '' && indentOf(body[k]) === 0 && !marker(body[k])) loose = true;
      }
      let task: boolean | null = null;
      const t = /^\[([ xX])\][ \t]+/.exec(body[0]);
      if (t) {
        task = t[1] !== ' ';
        body[0] = body[0].slice(t[0].length);
      }
      items.push({ task, c: parseBlocks(body.join('\n')) });
    }
    this.out.push({ t: 'list', ordered: first.ordered, start: first.start, loose, items });
  }
}

/** Parse a markdown document (without triple-backtick fences) into blocks. */
export function parseBlocks(src: string): Block[] {
  const lines = src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^\t+/, (tabs) => '    '.repeat(tabs.length)));
  return new BlockParser(lines).run();
}
