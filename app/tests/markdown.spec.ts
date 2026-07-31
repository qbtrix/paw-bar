// tests/markdown.spec.ts — Drift guard + behavior for the extracted markdown
// core. Created 2026-07-15 (A3 glass bar). The allowlist test PINS the exact
// DOMPurify ALLOWED_TAGS/ADD_ATTR arrays copied verbatim from paw-enterprise's
// MarkdownRenderer.svelte — this sanitizes agent-authored markdown on a PUBLIC
// origin, so any silent change to the allowlist is an XSS regression and must
// fail here. Runs under jsdom (DOMPurify.sanitize needs a window).
import { describe, it, expect } from 'vitest';
import {
  MARKDOWN_ALLOWED_TAGS,
  MARKDOWN_ADD_ATTR,
  renderMarkdown,
  parseSegments,
} from '../src/lib/markdown';

describe('DOMPurify allowlist (verbatim pin — do not relax)', () => {
  it('pins the exact ALLOWED_TAGS set copied from MarkdownRenderer.svelte', () => {
    expect(MARKDOWN_ALLOWED_TAGS).toEqual([
      'p', 'br', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'code', 'pre', 'hr', 'img', 'sup', 'sub', 'span', 'div',
      'input',
    ]);
  });

  it('pins the exact ADD_ATTR set', () => {
    expect(MARKDOWN_ADD_ATTR).toEqual([
      'target', 'rel', 'data-channel-id', 'type', 'disabled', 'checked', 'colspan', 'rowspan', 'scope',
    ]);
  });

  it('has no script/style/iframe/form/svg in the allowlist', () => {
    for (const forbidden of ['script', 'style', 'iframe', 'form', 'svg', 'object', 'embed', 'link']) {
      expect(MARKDOWN_ALLOWED_TAGS).not.toContain(forbidden);
    }
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
