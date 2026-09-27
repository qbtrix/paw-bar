// tests/spec-style.spec.ts — the filter on spec-supplied CSS, and theme to CSS
// variables. Created 2026-09-27 with the spec renderer.
//
// Spec styling is agent-written and lands on a customer's page. The cases
// below are the ways a declaration could fetch a resource or escape into
// another declaration; each must be dropped while ordinary values survive.

import { describe, it, expect } from 'vitest';
import { specStyle, themeStyle, themeVars, isSafeValue } from '../src/components/spec/style';

describe('isSafeValue', () => {
  it.each([
    'url(https://x.example/a.png)',
    'URL (x)',
    'image-set("a.png" 1x)',
    'expression(alert(1))',
    '@import "x.css"',
    'javascript:alert(1)',
    'red; position: fixed',
    'red } body { color: red',
    '<script>',
    '\\75rl(x)',
    'x'.repeat(201),
    '',
    '   ',
  ])('rejects %s', (value) => {
    expect(isSafeValue(value)).toBe(false);
  });

  it.each(['#ff5500', 'oklch(0.7 0.1 30)', 'calc(100% - 4px)', 'Inter, "Helvetica Neue", sans-serif', 'var(--pawbar-accent, red)'])(
    'keeps %s',
    (value) => {
      expect(isSafeValue(value)).toBe(true);
    },
  );

  it('rejects non-strings', () => {
    expect(isSafeValue(4)).toBe(false);
    expect(isSafeValue(null)).toBe(false);
  });
});

describe('specStyle', () => {
  it('serializes, kebab-cases and keeps custom properties', () => {
    expect(specStyle({ paddingTop: '4px', '--gap': '2px', color: 'red' })).toBe('padding-top: 4px; --gap: 2px; color: red');
  });

  it('drops bad names and dangerous properties', () => {
    expect(specStyle({ 'a b': 'red', 'color:': 'red', behavior: 'x', '-moz-binding': 'x', color: 'red' })).toBe('color: red');
  });

  it('returns undefined when nothing survives or the input is not a record', () => {
    expect(specStyle({ background: 'url(x)' })).toBeUndefined();
    expect(specStyle(undefined)).toBeUndefined();
    expect(specStyle('color: red')).toBeUndefined();
    expect(specStyle(['color', 'red'])).toBeUndefined();
  });
});

describe('themeVars', () => {
  it('uses the variable names Ripple uses', () => {
    expect(
      themeVars({ colors: { primary: '#000', 'muted-foreground': '#666' }, radius: '8px', fonts: { heading: 'Georgia', mono: 'monospace' } }),
    ).toEqual({
      '--primary': '#000',
      '--muted-foreground': '#666',
      '--radius': '8px',
      '--ripple-font-heading': 'Georgia',
      '--ripple-font-mono': 'monospace',
    });
  });

  it('drops unsafe values and odd token names', () => {
    expect(themeVars({ colors: { primary: 'url(x)', 'Bad Name': 'red', ok: 'red' }, radius: '1px; x: y' })).toEqual({ '--ok': 'red' });
  });

  it('is empty for no theme', () => {
    expect(themeVars(undefined)).toEqual({});
    expect(themeStyle(undefined)).toBe('');
  });
});
