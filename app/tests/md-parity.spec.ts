// tests/md-parity.spec.ts — the native markdown renderer against the path it
// replaced. Created 2026-09-27.
//
// tests/fixtures/md-oracle.ts is the old marked + DOMPurify renderer, kept
// verbatim. Each realistic reply below goes through both, and the two DOMs are
// reduced to a canonical form (tag names, sorted attributes, whitespace
// collapsed, Svelte's comment anchors and the newlines marked puts between
// blocks ignored) and must be EQUAL. A difference here is a visible change in
// how a reply looks under the thread's existing CSS.
//
// The hostile inputs are not compared for equality (the old path handled some
// of them by stripping, the new one never builds them); md-security.spec.ts
// asserts what must be true of those instead.

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Markdown from '../src/components/Markdown.svelte';
import { setLinkBase } from '../src/lib/markdown';
import { renderMarkdown as oracleRender, setLinkBase as oracleSetLinkBase } from './fixtures/md-oracle';
import { CORPUS } from './fixtures/md-corpus';

let live: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  setLinkBase(null);
  oracleSetLinkBase(null);
});

const BLOCK = 'p|ul|ol|li|h[1-6]|blockquote|table|thead|tbody|tr|th|td|hr|pre|div|br';

function canon(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const attrs = [...el.attributes]
    .filter((a) => !(tag === 'input' && a.name === 'checked'))
    .map((a) => `${a.name}="${a.value}"`);
  if (tag === 'input') attrs.push(`checked="${(el as HTMLInputElement).checked}"`);
  const inner = [...el.childNodes].map(canon).join('');
  return `<${tag}${attrs.sort().map((a) => ' ' + a).join('')}>${inner}</${tag}>`;
}

function normalize(html: string): string {
  return html
    .replace(new RegExp(`\\s*(</?(?:${BLOCK})\\b[^>]*>)\\s*`, 'g'), '$1')
    .trim();
}

function renderNew(md: string): string {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(Markdown, { target, props: { content: md } });
  flushSync();
  const root = target.querySelector('.pawbar-md')!;
  return normalize([...root.childNodes].map(canon).join(''));
}

function renderOld(md: string): string {
  const box = document.createElement('div');
  box.innerHTML = oracleRender(md);
  return normalize([...box.childNodes].map(canon).join(''));
}


describe('native markdown matches the old marked + DOMPurify output', () => {
  for (const [name, md] of Object.entries(CORPUS)) {
    it(name, () => {
      expect(renderNew(md)).toBe(renderOld(md));
    });
  }

  it('known difference: raw <span> and <div> keep their text but not the element', () => {
    // DOMPurify kept these two (allowlisted, but every attribute stripped), so
    // they rendered as bare wrappers with no effect. The native renderer has no
    // node for them and keeps only the text; nothing in the thread's CSS
    // targets either.
    expect(renderNew('a <span>b</span> c')).toBe('<p>a b c</p>');
    expect(renderOld('a <span>b</span> c')).toBe('<p>a <span>b</span> c</p>');
  });

  it('site-relative links resolve the same way', () => {
    setLinkBase('https://shop.example');
    oracleSetLinkBase('https://shop.example');
    const md = 'See [returns](/returns), [faq](faq), [frag](#x) and [evil](//evil.example).';
    expect(renderNew(md)).toBe(renderOld(md));
  });
});
