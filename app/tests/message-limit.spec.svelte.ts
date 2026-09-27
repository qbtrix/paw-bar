// tests/message-limit.spec.svelte.ts — the bar never sends what the backend
// will refuse. Created 2026-09-27, when the old shell was removed: this
// contract used to be covered by composer-limit.spec.ts against the old
// Composer, and the new bar's field enforces the same cap (PawBar.svelte).
//
// The paw_bar chat endpoint rejects a `message` over MAX_MESSAGE_CHARS with a
// 400, which the widget can only show as a generic failure. So the field caps
// input with maxlength, and send() refuses a longer value anyway, because a
// value set from script (a restored draft, a prefill) bypasses maxlength.

import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

import { mount, unmount, flushSync } from 'svelte';
import PawBarFrame, { type BarMessage } from '../src/components/bar/PawBarFrame.svelte';
import { MAX_MESSAGE_CHARS } from '../src/lib/composer/limits';

let live: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

function frame() {
  const target = document.createElement('div');
  document.body.append(target);
  const props = $state({
    messages: [] as BarMessage[],
    expanded: true,
    onsend: vi.fn(),
    onstop: vi.fn(),
    onretry: vi.fn(),
  });
  live = mount(PawBarFrame, { target, props });
  flushSync();
  return { target, props };
}

function typeAndEnter(target: HTMLElement, value: string) {
  const field = target.querySelector('textarea')!;
  field.value = value;
  field.dispatchEvent(new Event('input'));
  flushSync();
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  flushSync();
}

describe('message length cap', () => {
  it('the field carries the backend limit as maxlength', () => {
    const { target } = frame();
    expect(target.querySelector('textarea')!.getAttribute('maxlength')).toBe(String(MAX_MESSAGE_CHARS));
  });

  it('a message at the limit is sent', () => {
    const { target, props } = frame();
    typeAndEnter(target, 'a'.repeat(MAX_MESSAGE_CHARS));
    expect(props.onsend).toHaveBeenCalledOnce();
  });

  it('a message over the limit is refused, not sent to a 400', () => {
    const { target, props } = frame();
    typeAndEnter(target, 'a'.repeat(MAX_MESSAGE_CHARS + 1));
    expect(props.onsend).not.toHaveBeenCalled();
  });
});
