// tests/pawbar-frame.spec.svelte.ts — PawBarFrame, the parent around PawBar
// (2026-09-27). The thread shows only while the bar is open AND there is a
// conversation; a click on the thread must not fold it (it is outside the bar
// but inside the frame); Escape and a click on the page fold it away.
// Also: the thread must not scroll while its content still fits under the cap.
// It used to be overflow-y:auto always, so a streaming reply briefly taller
// than the still-springing box flipped the scrollbar on and off (10 flips in
// one reply, measured in Chromium) and reflowed the text each time.
// 2026-09-27 (states): rows carry a visually hidden speaker prefix ("You:",
// "Assistant:"), so text is read without it; a page click does not fold a
// reply that is still being written.
// 2026-09-27 (compliance): poweredBy={false} drops the credit but not the AI
// disclosure, which shares its line.
// Branding: the pill carries the site's logo (falling back to the plain mark
// when it fails to load), and "Powered by Paw Sites" shows only while open.

import { describe, it, expect, afterEach, vi } from 'vitest';

/** What a sighted visitor reads: the element's text minus the sr-only prefix. */
function seen(el: Element | null): string | undefined {
  if (!el) return undefined;
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('.sr-only').forEach((n) => n.remove());
  return c.textContent?.trim();
}

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
import { resizeObservers } from './setup';
import PawBarFrame, { type BarMessage } from '../src/components/bar/PawBarFrame.svelte';

let live: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

function render(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const props = $state({
    messages: [] as BarMessage[],
    onsend: vi.fn((text: string) => {
      props.messages.push({ id: `u${props.messages.length}`, role: 'user', content: text, status: 'done' });
      props.messages.push({ id: `a${props.messages.length}`, role: 'assistant', content: '', status: 'streaming' });
    }),
  });
  live = mount(PawBarFrame, { target, props: Object.assign(props, extra) });
  flushSync();
  return { target, props };
}

async function sendFromBar(target: HTMLElement, text: string) {
  target.querySelector<HTMLButtonElement>('.trigger')!.click();
  await tick();
  const field = target.querySelector('textarea')!;
  field.value = text;
  field.dispatchEvent(new Event('input'));
  flushSync();
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  flushSync();
}

const thread = (t: HTMLElement) => t.querySelector('.thread-inner');

describe('PawBarFrame', () => {
  it('rests as a frame around the pill, with no thread', () => {
    const { target } = render();
    expect(target.querySelector('.frame .pawbar .pill')).not.toBeNull();
    expect(thread(target)).toBeNull();
  });

  it('grows a thread after a send, with the visitor turn and a pending reply', async () => {
    const { target, props } = render();
    await sendFromBar(target, 'hello there');
    expect(props.onsend).toHaveBeenCalledWith('hello there');
    expect(seen(target.querySelector('.msg.user'))).toBe('hello there');
    expect(target.querySelector('.row.assistant .dots')).not.toBeNull();
  });

  it('a pending reply swaps its dots for text once text arrives', async () => {
    const { target, props } = render();
    await sendFromBar(target, 'hi');
    props.messages[1].content = 'Hello!';
    flushSync();
    expect(seen(target.querySelector('.msg.assistant'))).toBe('Hello!');
  });

  it('a click on the thread does not fold it', async () => {
    const { target } = render();
    await sendFromBar(target, 'hi');
    target.querySelector('.msg.user')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    flushSync();
    expect(thread(target)).not.toBeNull();
  });

  it('a click on the page does not fold a reply that is still being written', async () => {
    const { target } = render();
    await sendFromBar(target, 'hi');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    (document.activeElement as HTMLElement | null)?.blur();
    flushSync();
    expect(thread(target)).not.toBeNull();
  });

  it('a click on the page folds the thread away, keeping the messages', async () => {
    const { target, props } = render();
    await sendFromBar(target, 'hi');
    props.messages[1].content = 'Hello!';
    props.messages[1].status = 'done';
    flushSync();
    // A real click on the page also moves focus off the field; jsdom's
    // pointerdown does not, so do that half by hand.
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    (document.activeElement as HTMLElement | null)?.blur();
    flushSync();
    expect(thread(target)).toBeNull();
    expect(target.querySelector('.pill')).not.toBeNull();
    expect(props.messages).toHaveLength(2);
  });

  it('Escape folds the thread away', async () => {
    const { target } = render();
    await sendFromBar(target, 'hi');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();
    flushSync();
    expect(thread(target)).toBeNull();
  });

  it('only scrolls once the content is past the cap, never while it fits', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true }); // cap = 460
    const { target } = render();
    await sendFromBar(target, 'hi');
    const inner = target.querySelector<HTMLElement>('.thread-inner')!;
    const threadEl = target.querySelector<HTMLElement>('.thread')!;

    const measure = (h: number) => {
      Object.defineProperty(inner, 'offsetHeight', { value: h, configurable: true });
      for (const ro of resizeObservers) ro.fire();
      flushSync();
    };

    measure(300); // a reply still streaming in, well under the cap
    expect(threadEl.style.overflowY).toBe('hidden');
    measure(600); // past the cap: now it is a scroller
    expect(threadEl.style.overflowY).toBe('auto');
  });

  it('puts the site logo in the pill, and falls back to the mark if it fails', () => {
    const { target } = render({ logoSrc: 'https://example.com/logo.png' });
    const img = target.querySelector<HTMLImageElement>('.pill img.brand')!;
    expect(img.getAttribute('src')).toBe('https://example.com/logo.png');
    img.dispatchEvent(new Event('error'));
    flushSync();
    expect(target.querySelector('.pill img')).toBeNull();
    expect(target.querySelector('.pill .mark')).not.toBeNull();
  });

  it('shows "Powered by Paw Sites" only while open, outside the chat surface', () => {
    const { target } = render();
    expect(target.querySelector('.credit')).toBeNull();
    target.querySelector('.frame-wrap')!.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    flushSync();
    expect(target.querySelector('.credit')?.textContent).toContain('Powered by Paw Sites');
    expect(target.querySelector('.frame .credit')).toBeNull();
  });

  it('hover anywhere on the frame keeps the bar open, including the credit', () => {
    vi.useFakeTimers();
    const { target } = render();
    const frame = target.querySelector('.frame-wrap')!;
    frame.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    flushSync();
    // Leaving the bar's own box for the credit line below is not leaving.
    target.querySelector('.pawbar')!.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    vi.advanceTimersByTime(300);
    flushSync();
    expect(target.querySelector('.credit')).not.toBeNull();
    frame.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    vi.advanceTimersByTime(300);
    flushSync();
    expect(target.querySelector('.credit')).toBeNull();
    vi.useRealTimers();
  });

  it('poweredBy={false} drops the credit and keeps the AI disclosure', () => {
    const { target } = render({ poweredBy: false });
    target.querySelector('.frame-wrap')!.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    flushSync();
    const line = target.querySelector('.credit')!;
    expect(line.textContent).not.toContain('Paw Sites');
    expect(line.textContent).toContain('AI assistant');
  });
});
