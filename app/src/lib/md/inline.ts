// lib/md/inline.ts — inline markdown to Inline nodes.
// Created 2026-09-27 with the native markdown renderer.
//
// Covers what the old marked (gfm + breaks) path rendered for model replies:
// **strong** / __strong__, *em* / _em_ (no intraword _), ~~del~~ / ~del~,
// `code`, [links](url "title"), ![images](url) as their alt text, <autolinks>,
// bare https:// / www. / email autolinks, backslash escapes, character
// references, and a line break for every newline.
//
// Raw HTML follows what DOMPurify did to marked's output: an allowlisted inline
// tag becomes its node (strong, em, del, code, sup, sub, br, and a with its href
// vetted), any other tag is dropped and its text kept, and the tags whose
// content DOMPurify also dropped (script, style, iframe, svg, ...) lose their
// content too. Comments vanish.

import { decodeEntities } from './entities';
import { safeHref } from './links';
import type { Inline } from './types';

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const isWs = (c: string | undefined) => c === undefined || /\s/.test(c);
const isPunct = (c: string | undefined) => c !== undefined && (ASCII_PUNCT.test(c) || /\p{P}|\p{S}/u.test(c));

// DOMPurify's default FORBID_CONTENTS, minus tags this renderer emits.
const DROP_CONTENT = new Set([
  'annotation-xml', 'audio', 'desc', 'foreignobject', 'head', 'iframe', 'math', 'mi', 'mn', 'mo', 'ms',
  'mtext', 'noembed', 'noframes', 'noscript', 'plaintext', 'script', 'style', 'svg', 'template', 'title',
  'video', 'xmp', 'textarea', 'select',
]);
const NODE_TAGS: Record<string, 'strong' | 'em' | 'del' | 'code' | 'sup' | 'sub'> = {
  strong: 'strong', em: 'em', del: 'del', code: 'code', sup: 'sup', sub: 'sub',
};

const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
const AUTOLINK_RE = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/;
const EMAIL_AUTOLINK_RE = /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;
const URL_START_RE = /^(?:https?:\/\/|www\.)/i;
const EMAIL_RE = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9_-]+)+/;

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/** Trim what GFM does not count as part of a bare URL. */
function trimAutolink(url: string): string {
  for (;;) {
    const before = url;
    url = url.replace(/[?!.,:*_~'"]+$/, '');
    if (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
    url = url.replace(/&[a-zA-Z0-9]+;$/, '');
    if (url === before) return url;
  }
}

/** Unescape a link destination or title: backslash escapes, then references. */
function unescape(s: string): string {
  return decodeEntities(s.replace(/\\([!-/:-@[-`{-~])/g, '$1'));
}

class InlineParser {
  private out: Inline[] = [];
  private text = '';
  private i = 0;

  constructor(private s: string, private inLink = false) {}

  run(): Inline[] {
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === '\\') this.escape();
      else if (c === '\n') this.newline();
      else if (c === '`') this.codeSpan();
      else if (c === '!' && s[this.i + 1] === '[') this.linkOrImage(true);
      else if (c === '[') this.linkOrImage(false);
      else if (c === '<') this.angle();
      else if (c === '*' || c === '_' || c === '~') this.emphasis(c);
      else if (!this.inLink && this.atWordStart() && this.autolinkLiteral()) continue;
      else this.char(c);
    }
    this.flush();
    return this.out;
  }

  private char(c: string, advance = 1) {
    this.text += c;
    this.i += advance;
  }

  private flush() {
    if (!this.text) return;
    const v = decodeEntities(this.text);
    const last = this.out[this.out.length - 1];
    if (last && last.t === 'text') last.v += v;
    else this.out.push({ t: 'text', v });
    this.text = '';
  }

  private push(node: Inline) {
    this.flush();
    this.out.push(node);
  }

  private pushAll(nodes: Inline[]) {
    for (const n of nodes) {
      if (n.t === 'text') this.text += n.v.replace(/&/g, '&amp;'); // re-escaped so flush decodes once
      else this.push(n);
    }
  }

  private atWordStart(): boolean {
    const prev = this.s[this.i - 1];
    return prev === undefined || isWs(prev) || '*_~(\'"'.includes(prev);
  }

  private escape() {
    const next = this.s[this.i + 1];
    if (next === '\n') {
      this.i += 1; // the newline itself becomes the break
    } else if (next !== undefined && ASCII_PUNCT.test(next)) {
      // `&` escaped must not start a reference when flushed.
      this.char(next === '&' ? '&amp;' : next, 2);
    } else {
      this.char('\\');
    }
  }

  private newline() {
    this.text = this.text.replace(/[ \t]+$/, '');
    this.push({ t: 'br' });
    this.i += 1;
    while (this.s[this.i] === ' ' || this.s[this.i] === '\t') this.i += 1;
  }

  /** Length of the run of `c` starting at `at`. */
  private runLength(at: number, c: string): number {
    let n = 0;
    while (this.s[at + n] === c) n += 1;
    return n;
  }

  private codeSpan() {
    const n = this.runLength(this.i, '`');
    let j = this.i + n;
    while (j < this.s.length) {
      const k = this.s.indexOf('`', j);
      if (k === -1) break;
      const m = this.runLength(k, '`');
      if (m === n) {
        let v = this.s.slice(this.i + n, k).replace(/\n/g, ' ');
        if (v.length > 2 && v.startsWith(' ') && v.endsWith(' ') && v.trim()) v = v.slice(1, -1);
        this.push({ t: 'code', v });
        this.i = k + m;
        return;
      }
      j = k + m;
    }
    this.char('`'.repeat(n), n);
  }

  /** Index of the `]` closing the bracket at `open`, or -1. */
  private closeBracket(open: number): number {
    let depth = 0;
    for (let j = open; j < this.s.length; j++) {
      const c = this.s[j];
      if (c === '\\') j += 1;
      else if (c === '`') {
        const n = this.runLength(j, '`');
        const close = this.s.indexOf('`'.repeat(n), j + n);
        if (close !== -1) j = close + n - 1;
        else j += n - 1;
      } else if (c === '[') depth += 1;
      else if (c === ']' && --depth === 0) return j;
    }
    return -1;
  }

  /** Parse `(dest "title")` at `at`; returns the destination and end index. */
  private destination(at: number): { dest: string; end: number } | null {
    const s = this.s;
    if (s[at] !== '(') return null;
    let j = at + 1;
    while (s[j] === ' ' || s[j] === '\n' || s[j] === '\t') j += 1;
    let dest = '';
    if (s[j] === '<') {
      const close = s.indexOf('>', j);
      if (close === -1 || s.slice(j + 1, close).includes('\n')) return null;
      dest = s.slice(j + 1, close);
      j = close + 1;
    } else {
      let depth = 0;
      const start = j;
      while (j < s.length) {
        const c = s[j];
        if (c === '\\' && j + 1 < s.length) j += 2;
        else if (c === '(') { depth += 1; j += 1; }
        else if (c === ')') { if (depth === 0) break; depth -= 1; j += 1; }
        else if (/\s/.test(c)) break;
        else j += 1;
      }
      dest = s.slice(start, j);
    }
    while (s[j] === ' ' || s[j] === '\n' || s[j] === '\t') j += 1;
    const q = s[j];
    if (q === '"' || q === "'" || q === '(') {
      const closeQ = q === '(' ? ')' : q;
      let k = j + 1;
      while (k < s.length && s[k] !== closeQ) k += s[k] === '\\' ? 2 : 1;
      if (k >= s.length) return null;
      j = k + 1;
      while (s[j] === ' ' || s[j] === '\n' || s[j] === '\t') j += 1;
    }
    if (s[j] !== ')') return null;
    return { dest: unescape(dest), end: j + 1 };
  }

  private linkOrImage(image: boolean) {
    const open = this.i + (image ? 1 : 0);
    const close = this.closeBracket(open);
    const target = close === -1 ? null : this.destination(close + 1);
    if (!target || (!image && this.inLink)) {
      this.char(image ? '!' : '[');
      return;
    }
    const label = this.s.slice(open + 1, close);
    if (image) {
      // Model-written images would be a request fired on render: alt text only.
      this.flush();
      this.text += label;
    } else {
      this.push({ t: 'link', href: safeHref(target.dest), c: new InlineParser(label, true).run() });
    }
    this.i = target.end;
  }

  private angle() {
    const rest = this.s.slice(this.i);
    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->');
      this.i += end === -1 ? rest.length : end + 3;
      return;
    }
    const auto = AUTOLINK_RE.exec(rest);
    if (auto && !this.inLink) {
      this.push({ t: 'link', href: safeHref(auto[1]), c: [{ t: 'text', v: auto[1] }] });
      this.i += auto[0].length;
      return;
    }
    const mail = EMAIL_AUTOLINK_RE.exec(rest);
    if (mail && !this.inLink) {
      this.push({ t: 'link', href: safeHref(`mailto:${mail[1]}`), c: [{ t: 'text', v: mail[1] }] });
      this.i += mail[0].length;
      return;
    }
    const tag = TAG_RE.exec(rest);
    if (!tag) {
      this.char('<');
      return;
    }
    const [whole, closing, rawName, attrs] = tag;
    const name = rawName.toLowerCase();
    this.i += whole.length;
    if (closing) return; // a stray closing tag: dropped
    if (name === 'br') {
      this.push({ t: 'br' });
      return;
    }
    const closeTag = new RegExp(`</${name}\\s*>`, 'i');
    const after = this.s.slice(this.i);
    const m = closeTag.exec(after);
    if (DROP_CONTENT.has(name)) {
      this.i += m ? m.index + m[0].length : after.length;
      return;
    }
    const kind = NODE_TAGS[name];
    if ((!kind && name !== 'a') || !m) return; // other tags: drop the tag, keep the text
    const inner = after.slice(0, m.index);
    this.i += m.index + m[0].length;
    if (name === 'a') {
      if (this.inLink) this.pushAll(new InlineParser(inner, true).run());
      else {
        const href = attr(attrs, 'href');
        // An HTML attribute has no backslash escapes: decode references only, or
        // two leading backslashes (protocol-relative, dropped) would become one
        // (a same-origin path, kept).
        this.push({ t: 'link', href: href === null ? null : safeHref(decodeEntities(href)), c: new InlineParser(inner, true).run() });
      }
    } else if (kind === 'code') {
      this.push({ t: 'code', v: decodeEntities(inner.replace(/<[^>]*>/g, '')) });
    } else {
      this.push({ t: kind, c: new InlineParser(inner, this.inLink).run() });
    }
  }

  private canOpen(at: number, len: number, c: string): boolean {
    const prev = this.s[at - 1];
    const next = this.s[at + len];
    if (isWs(next)) return false;
    const left = !isPunct(next) || isWs(prev) || isPunct(prev);
    if (!left) return false;
    if (c !== '_') return true;
    const right = !isWs(prev) && (!isPunct(prev) || isWs(next) || isPunct(next));
    return !right || isPunct(prev);
  }

  private canClose(at: number, len: number, c: string): boolean {
    const prev = this.s[at - 1];
    const next = this.s[at + len];
    if (isWs(prev)) return false;
    const right = !isPunct(prev) || isWs(next) || isPunct(next);
    if (!right) return false;
    if (c !== '_') return true;
    const left = !isWs(next) && (!isPunct(next) || isWs(prev) || isPunct(prev));
    return !left || isPunct(next);
  }

  /** Find a closing run of `c` usable for an opener needing `need`. */
  private findCloser(from: number, c: string, need: number, exact: boolean): { at: number; len: number } | null {
    for (let j = from; j < this.s.length; j++) {
      const ch = this.s[j];
      if (ch === '\\') { j += 1; continue; }
      if (ch === '`') {
        const n = this.runLength(j, '`');
        const close = this.s.indexOf('`'.repeat(n), j + n);
        j = close === -1 ? j + n - 1 : close + n - 1;
        continue;
      }
      if (ch !== c) continue;
      const len = this.runLength(j, c);
      const fits = exact ? len === need : need === 1 ? len === 1 || len >= 3 : len >= need;
      if (fits && this.canClose(j, len, c)) return { at: j, len };
      j += len - 1;
    }
    return null;
  }

  private emphasis(c: string) {
    const len = this.runLength(this.i, c);
    if (c === '~') {
      const closer = len <= 2 && this.canOpen(this.i, len, c) ? this.findCloser(this.i + len, c, len, true) : null;
      if (!closer) {
        this.char(c.repeat(len), len);
        return;
      }
      this.push({ t: 'del', c: new InlineParser(this.s.slice(this.i + len, closer.at), this.inLink).run() });
      this.i = closer.at + len;
      return;
    }
    if (!this.canOpen(this.i, len, c)) {
      this.char(c.repeat(len), len);
      return;
    }
    const tries: Array<[number, 'strong' | 'em' | 'both']> =
      len >= 3 ? [[3, 'both'], [2, 'strong'], [1, 'em']] : len === 2 ? [[2, 'strong'], [1, 'em']] : [[1, 'em']];
    for (const [need, kind] of tries) {
      const closer = this.findCloser(this.i + need, c, need, kind === 'both');
      if (!closer || closer.at === this.i + need) continue;
      // Surplus opening delimiters stay literal, before the node.
      if (len > need) this.char(c.repeat(len - need), len - need);
      const inner = new InlineParser(this.s.slice(this.i + need, closer.at), this.inLink).run();
      const node: Inline =
        kind === 'both' ? { t: 'em', c: [{ t: 'strong', c: inner }] } : { t: kind, c: inner };
      this.push(node);
      this.i = closer.at + need;
      return;
    }
    this.char(c.repeat(len), len);
  }

  private autolinkLiteral(): boolean {
    const rest = this.s.slice(this.i);
    if (URL_START_RE.test(rest)) {
      const raw = trimAutolink(/^[^\s<]*/.exec(rest)![0]);
      const host = raw.replace(/^https?:\/\//i, '');
      if (!/^[a-zA-Z0-9-_]+(\.[a-zA-Z0-9-_]+)*\.?/.test(host) || !host.includes('.') && /^www\./i.test(raw)) return false;
      if (host.length === 0 || host.startsWith('.')) return false;
      const href = /^www\./i.test(raw) ? `http://${raw}` : raw;
      this.push({ t: 'link', href: safeHref(decodeEntities(href)), c: [{ t: 'text', v: decodeEntities(raw) }] });
      this.i += raw.length;
      return true;
    }
    const email = EMAIL_RE.exec(rest);
    if (email) {
      let addr = email[0].replace(/\.+$/, '');
      if (/[-_]$/.test(addr)) return false;
      addr = addr.replace(/\.+$/, '');
      this.push({ t: 'link', href: safeHref(`mailto:${addr}`), c: [{ t: 'text', v: addr }] });
      this.i += addr.length;
      return true;
    }
    return false;
  }
}

/** Parse one run of inline markdown (a paragraph, heading or table cell). */
export function parseInline(s: string): Inline[] {
  return new InlineParser(s).run();
}
