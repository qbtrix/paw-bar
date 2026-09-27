// tests/pawbar-morph.spec.svelte.ts — the single-component PawBar (2026-09-27).
// Covers which face shows when: hover opens it for a mouse only, click opens
// and focuses the field, a draft holds it open after the pointer leaves,
// Escape folds it back, and Enter sends. 2026-09-27: no suggestion chips; the
// only chip is "Talk to a person".

import { describe, it, expect, afterEach, vi } from 'vitest';

// jsdom has no matchMedia, and svelte/motion builds prefersReducedMotion from
// it at import. Answer "reduce" so transitions are instant and the DOM settles
// synchronously.
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
import { mount, unmount, flushSync, tick } from 'svelte';
import PawBar from '../src/components/bar/PawBar.svelte';

let live: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function render(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const onsend = vi.fn();
  live = mount(PawBar, {
    target,
    props: { onsend, ...extra },
  });
  flushSync();
  // Hover and focus are tracked on the host, which also holds the menu; the
  // `expanded` class is on the surface inside it.
  const host = target.querySelector<HTMLElement>('.pawbar-host')!;
  const root = target.querySelector<HTMLElement>('.pawbar')!;
  return { target, host, root, onsend };
}

function pointer(el: Element, type: string, pointerType = 'mouse') {
  el.dispatchEvent(new PointerEvent(type, { pointerType, bubbles: false }));
  flushSync();
}

const card = (t: HTMLElement) => t.querySelector('.card');

describe('PawBar morph', () => {
  it('rests as the pill', () => {
    const { target } = render();
    expect(target.querySelector('.pill')).not.toBeNull();
    expect(card(target)).toBeNull();
  });

  it('opens on mouse hover without stealing focus, and closes on leave', () => {
    vi.useFakeTimers();
    const { target, root, host } = render();
    pointer(host, 'pointerenter');
    expect(card(target)).not.toBeNull();
    expect(document.activeElement?.tagName).not.toBe('TEXTAREA');
    pointer(host, 'pointerleave');
    vi.advanceTimersByTime(200);
    flushSync();
    expect(root.classList.contains('expanded')).toBe(false);
  });

  it('ignores a touch pointerenter', () => {
    const { target, host } = render();
    pointer(host, 'pointerenter', 'touch');
    expect(card(target)).toBeNull();
  });

  it('opens and focuses the field on click', async () => {
    const { target } = render();
    target.querySelector<HTMLButtonElement>('.trigger')!.click();
    await tick();
    flushSync();
    expect(document.activeElement).toBe(target.querySelector('textarea'));
  });

  it('stays open while it holds a draft, even after the pointer leaves', () => {
    vi.useFakeTimers();
    const { target, root, host } = render();
    pointer(host, 'pointerenter');
    const field = target.querySelector('textarea')!;
    field.value = 'half a question';
    field.dispatchEvent(new Event('input'));
    flushSync();
    pointer(host, 'pointerleave');
    vi.advanceTimersByTime(200);
    flushSync();
    expect(root.classList.contains('expanded')).toBe(true);
  });

  it('sends on Enter and clears the field', async () => {
    const { target, onsend } = render();
    target.querySelector<HTMLButtonElement>('.trigger')!.click();
    await tick();
    const field = target.querySelector('textarea')!;
    field.value = 'hello';
    field.dispatchEvent(new Event('input'));
    flushSync();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    expect(onsend).toHaveBeenCalledWith('hello');
    expect(field.value).toBe('');
  });

  it('folds back on Escape', async () => {
    const { target, root } = render();
    target.querySelector<HTMLButtonElement>('.trigger')!.click();
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();
    flushSync();
    expect(root.classList.contains('expanded')).toBe(false);
  });

  it('the card has no suggestion chips, only the person chip when there is a human path', () => {
    const { target, host } = render({ onrequesthuman: vi.fn() });
    pointer(host, 'pointerenter');
    const chips = [...target.querySelectorAll('.chip')];
    expect(chips.map((c) => c.textContent?.trim())).toEqual(['Talk to a person']);
  });
});
