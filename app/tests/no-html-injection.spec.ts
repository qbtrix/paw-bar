// tests/no-html-injection.spec.ts — the app builds no HTML from strings.
// Created 2026-09-27 with the native markdown renderer.
//
// The markdown path used to be the one place a string became markup ({@html}
// on DOMPurify output). It isn't any more, and that is the property the change
// was for: with no HTML sink there is nothing for a model-written reply to
// inject into. This keeps it that way by scanning every source file for the
// sinks. If you genuinely need one, it needs a sanitizer and a security review,
// and this test is where that conversation starts.

import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob(['../src/**/*.ts', '../src/**/*.svelte'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Drop comments so prose that mentions a sink doesn't count as one. */
function code(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, '$1');
}

const SINKS: Array<[string, RegExp]> = [
  ['{@html}', /\{@html\s/],
  ['innerHTML/outerHTML assignment', /\.(?:inner|outer)HTML\s*\+?=(?!=)/],
  ['insertAdjacentHTML', /\.insertAdjacentHTML\s*\(/],
  ['document.write', /document\.write(?:ln)?\s*\(/],
  ['createContextualFragment', /createContextualFragment\s*\(/],
  ['DOMParser', /new\s+DOMParser\s*\(/],
];

describe('no HTML string sinks in app/src', () => {
  it('scans the real source tree', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    expect(Object.keys(SOURCES)).toContain('../src/components/Markdown.svelte');
  });

  for (const [name, re] of SINKS) {
    it(`uses no ${name}`, () => {
      const hits = Object.entries(SOURCES)
        .filter(([, src]) => re.test(code(src)))
        .map(([file]) => file);
      expect(hits).toEqual([]);
    });
  }

  it('would catch one', () => {
    expect(SINKS[0][1].test(code('<div>{@html x}</div>'))).toBe(true);
    expect(SINKS[1][1].test(code('el.innerHTML = s;'))).toBe(true);
    expect(SINKS[1][1].test(code('// el.innerHTML = s;'))).toBe(false);
  });
});
