// tests/autosize.spec.ts — the composer's height comes from its VALUE.
// Created 2026-08-19.
//
// THE BUG THIS EXISTS FOR: the resting bar stood 24px taller than the same bar
// on hover, and shrank as it widened — backwards, and the first thing anyone
// noticed about it. Cause: `scrollHeight` counts the PLACEHOLDER, so in the
// narrow resting slot "Ask about this site" wrapped to two lines and autosize
// grew the textarea to fit a hint nobody was reading. Widening the slot let the
// hint fit one line, so the bar got shorter.
//
// jsdom does not lay text out, so it cannot reproduce the wrap. What it CAN pin
// is the invariant that makes the wrap irrelevant: an empty textarea is
// measured with the placeholder suppressed. The stub below fails the old code
// and passes the new, which is the only property worth asserting here.

import { describe, it, expect, beforeAll } from 'vitest';
import { autosize } from '../src/lib/composer/autosize';

// jsdom ships no ResizeObserver. The action observes width to re-measure; the
// height rules under test do not depend on it firing, so a no-op stub is
// enough — and stubbing it here beats weakening the action for tests.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    };
  }
});

/** A textarea whose scrollHeight depends on the placeholder, the way a real one
 *  does at a narrow width: a long hint wraps to two rows, nothing is one row. */
function makeTextarea(rowPx = 36): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  Object.defineProperty(el, 'scrollHeight', {
    get(): number {
      const lines = el.value
        ? el.value.split('\n').length
        : el.placeholder.length > 12
          ? 2
          : 1;
      return lines * rowPx;
    },
  });
  return el;
}

describe('autosize', () => {
  it('measures an EMPTY textarea at one row, whatever the placeholder wraps to', () => {
    const el = makeTextarea();
    el.placeholder = 'Ask about this site';

    autosize(el);

    // 36, not 72. The placeholder is a hint about what to type; it must not set
    // the height of the thing you type into.
    expect(el.style.height).toBe('36px');
  });

  it('leaves the placeholder in place after measuring', () => {
    const el = makeTextarea();
    el.placeholder = 'Ask about this site';

    autosize(el);

    // It is blanked only for the measurement. Losing it would trade a layout
    // bug for a missing hint.
    expect(el.placeholder).toBe('Ask about this site');
  });

  it('is the SAME height at every width while empty', () => {
    // The regression stated directly: the resting pill and the widened pill
    // must agree, so the bar never changes height as it grows sideways.
    const narrow = makeTextarea();
    narrow.placeholder = 'Ask about this site';
    const wide = makeTextarea();
    wide.placeholder = 'Ask';

    autosize(narrow);
    autosize(wide);

    expect(narrow.style.height).toBe(wide.style.height);
  });

  it('still grows with real content, and still caps at maxHeight', () => {
    const el = makeTextarea();
    el.placeholder = 'Ask about this site';
    el.value = ['one', 'two', 'three'].join('\n');

    autosize(el);

    expect(el.style.height).toBe('108px');

    el.value = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    el.dispatchEvent(new Event('input'));

    expect(el.style.height).toBe('160px');
    expect(el.style.overflowY).toBe('auto');
  });

  it('returns to one row when the visitor clears what they typed', () => {
    const el = makeTextarea();
    el.placeholder = 'Ask about this site';
    el.value = ['one', 'two', 'three'].join('\n');
    autosize(el);
    expect(el.style.height).toBe('108px');

    el.value = '';
    el.dispatchEvent(new Event('input'));

    // Not 72 — sending a message must not leave the bar standing tall.
    expect(el.style.height).toBe('36px');
    expect(el.style.overflowY).toBe('hidden');
  });
});
