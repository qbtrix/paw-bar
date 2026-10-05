// tests/pawbar-options.spec.svelte.ts — the bar's owner and visitor options
// (2026-09-27): the ⋯ size menu, an owner opt-in since the menu was cleared
// out (the visitor's pick is stored and beats the site default), full screen
// (an icon in the card's top row; Escape leaves it before closing anything), the icon launcher (click-only, ✕ to close), and the site theme
// under the owner's tokens (applied as --pawbar-* properties, cleared when it
// changes), corners included.
// 2026-09-27: ✕ closes the card on both launchers and from full screen, even
// with a draft typed (the draft comes back on the next open), a pointer left
// over the bar cannot hover it back open until it leaves, and the
// conversation list has its own ✕. The controls (clock, full screen, ✕)
// live in a header at the top of the chat, never in the input. Inside the
// widget iframe, narrow checks and clamps read `hostViewport`, not the window.

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

import { mount, unmount, flushSync, tick } from 'svelte';
import PawBarFrame from '../src/components/bar/PawBarFrame.svelte';
import { SIZE_KEY } from '../src/components/bar/PawBar.svelte';
import { resolveTheme } from '../src/lib/bar-themes';

let live: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

function render(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: Record<string, any> = $state({ messages: [], onsend: vi.fn(), ...extra });
  live = mount(PawBarFrame, { target, props: props as never });
  flushSync();
  return { target, props };
}

const q = <T extends Element = HTMLElement>(t: HTMLElement, sel: string) => t.querySelector<T & HTMLElement>(sel);

async function openMenu(t: HTMLElement) {
  q<HTMLButtonElement>(t, '.pill button[aria-label="Chat options"]')!.click();
  await tick();
  flushSync();
}

describe('size', () => {
  it('starts at the site default', () => {
    const { target } = render({ size: 'lg' });
    expect(q(target, '.pawbar-host')!.dataset.size).toBe('lg');
    expect(q(target, '.frame-wrap')!.dataset.size).toBe('lg');
  });

  it("a visitor's pick is applied, stored, and beats the site default next time", async () => {
    const { target } = render({ size: 'md', resizable: true });
    await openMenu(target);
    const items = [...target.querySelectorAll<HTMLButtonElement>('.menu-item[role="menuitemradio"]')];
    expect(items.map((b) => b.textContent?.trim())).toEqual(['Compact', 'Default', 'Large']);
    expect(items[1].getAttribute('aria-checked')).toBe('true');
    items[0].click();
    await tick();
    flushSync();
    expect(q(target, '.pawbar-host')!.dataset.size).toBe('sm');
    expect(localStorage.getItem(SIZE_KEY)).toBe('sm');

    unmount(live!);
    document.body.innerHTML = '';
    const again = render({ size: 'lg', resizable: true });
    expect(q(again.target, '.pawbar-host')!.dataset.size).toBe('sm');
  });

  it('ignores a stored value that is not a size', () => {
    localStorage.setItem(SIZE_KEY, 'huge');
    const { target } = render({ size: 'lg' });
    expect(q(target, '.pawbar-host')!.dataset.size).toBe('lg');
  });

  it('there is no menu unless the owner turns sizes on', () => {
    const { target } = render();
    expect(q(target, 'button[aria-label="Chat options"]')).toBeNull();
  });
});

describe('full screen', () => {
  it('turns on from the top-row icon and Escape leaves it before closing the card', async () => {
    const { target } = render({ expanded: true });
    q<HTMLButtonElement>(target, 'button[aria-label="Full screen"]')!.click();
    await tick();
    flushSync();
    expect(q(target, '.frame-wrap')!.dataset.full).toBe('true');
    expect(q(target, 'button[aria-label="Exit full screen"]')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();
    flushSync();
    expect(q(target, '.frame-wrap')!.dataset.full).toBeUndefined();
    expect(q(target, '.card')).not.toBeNull();
  });
});

describe('icon launcher', () => {
  it('rests as one button, ignores hover, opens on click and closes on ✕', async () => {
    const { target } = render({ launcher: 'icon', side: 'left' });
    expect(q(target, '.pill')).toBeNull();
    expect(q(target, '.frame-wrap')!.dataset.anchor).toBe('left');

    q(target, '.frame-wrap')!.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    flushSync();
    expect(q(target, '.card')).toBeNull();

    q<HTMLButtonElement>(target, '.launch')!.click();
    await tick();
    flushSync();
    expect(q(target, '.card')).not.toBeNull();

    q<HTMLButtonElement>(target, 'button[aria-label="Close chat"]')!.click();
    await tick();
    flushSync();
    expect(q(target, '.card')).toBeNull();
    expect(q(target, '.launch')).not.toBeNull();
  });
});

describe('close (✕)', () => {
  const closeBtn = (t: HTMLElement) => q<HTMLButtonElement>(t, '.frame-head button[aria-label="Close chat"]')!;
  const type = (t: HTMLElement, v: string) => {
    const f = q<HTMLTextAreaElement>(t, 'textarea')!;
    f.value = v;
    f.dispatchEvent(new Event('input'));
    flushSync();
  };

  it('the controls sit in a header at the top, and the input holds none of them', () => {
    const { target } = render({
      expanded: true,
      messages: [{ id: 'u1', role: 'user', content: 'hi', status: 'done' }],
      onopenconversation: vi.fn(),
    });
    const head = q(target, '.frame-head')!;
    expect([...head.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Your conversations',
      'Full screen',
      'Close chat',
    ]);
    const card = q(target, '.card')!;
    expect(card.querySelector('button[aria-label="Close chat"]')).toBeNull();
    expect(card.querySelector('button[aria-label="Full screen"]')).toBeNull();
    expect(card.querySelector('button[aria-label="Your conversations"]')).toBeNull();
  });

  it('a card opened by hover with nothing to show has no header', () => {
    const { target } = render();
    q(target, '.frame-wrap')!.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    flushSync();
    expect(q(target, '.card')).not.toBeNull();
    expect(q(target, '.frame-head')).toBeNull();
  });

  it('a press inside a hover-opened card pins it, and the header comes with it', () => {
    const { target, props } = render({ expanded: false });
    q(target, '.frame-wrap')!.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    flushSync();
    q(target, 'textarea')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    flushSync();
    expect(props.expanded).toBe(true);
    expect(q(target, '.frame-head')).not.toBeNull();
  });

  it('the bar launcher has one too, and it closes the card', async () => {
    const { target, props } = render({ expanded: true });
    closeBtn(target).click();
    await tick();
    flushSync();
    expect(q(target, '.card')).toBeNull();
    expect(q(target, '.pill')).not.toBeNull();
    expect(props.expanded).toBe(false);
  });

  it('closes even with a draft typed, and the draft comes back on the next open', async () => {
    const { target, props } = render({ expanded: true });
    type(target, 'half a question');
    closeBtn(target).click();
    await tick();
    flushSync();
    expect(q(target, '.card')).toBeNull();

    props.expanded = true;
    flushSync();
    expect(q<HTMLTextAreaElement>(target, 'textarea')!.value).toBe('half a question');
  });

  it('a pointer still over the bar does not reopen it; leaving and coming back does', async () => {
    const { target } = render({ expanded: true });
    const wrap = q(target, '.frame-wrap')!;
    const enter = () => {
      wrap.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
      flushSync();
    };
    enter();
    closeBtn(target).click();
    await tick();
    flushSync();
    enter();
    expect(q(target, '.card')).toBeNull();

    document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
    enter();
    expect(q(target, '.card')).not.toBeNull();
  });

  it('closes from full screen in one go', async () => {
    const { target } = render({ expanded: true, fullscreen: true });
    closeBtn(target).click();
    await tick();
    flushSync();
    expect(q(target, '.frame-wrap')!.dataset.full).toBeUndefined();
    expect(q(target, '.card')).toBeNull();
  });

  it('the conversation list has its own ✕ that closes the bar', async () => {
    const { target } = render({
      expanded: true,
      messages: [{ id: 'u1', role: 'user', content: 'hi', status: 'done' }],
      onopenconversation: vi.fn(),
    });
    q<HTMLButtonElement>(target, 'button[aria-label="Your conversations"]')!.click();
    await tick();
    flushSync();
    q<HTMLButtonElement>(target, '.list-close')!.click();
    await tick();
    flushSync();
    expect(q(target, '.card')).toBeNull();
    expect(q(target, '.history-row')).toBeNull();
  });
});

describe('host viewport (inside the widget iframe)', () => {
  it('narrow checks and width clamps read the host page, not the window', () => {
    const { target, props } = render({ hostViewport: { w: 320, h: 700 } });
    const wrap = q(target, '.frame-wrap')!;
    expect(wrap.style.getPropertyValue('--pb-host-w')).toBe('320px');
    expect(wrap.style.getPropertyValue('--pb-host-h')).toBe('700px');
    expect(q(target, '.pawbar-host')!.dataset.narrow).toBe('true');

    props.hostViewport = { w: 1280, h: 800 };
    flushSync();
    expect(q(target, '.pawbar-host')!.dataset.narrow).toBeUndefined();
  });

  it('a narrow HOST opens a conversation full screen, whatever the window says', () => {
    const { target, props } = render({
      expanded: false,
      hostViewport: { w: 390, h: 800 },
      messages: [{ id: 'u1', role: 'user', content: 'hi', status: 'done' }],
    });
    props.expanded = true;
    flushSync();
    expect(q(target, '.frame-wrap')!.dataset.full).toBe('true');
  });
});

describe('the site theme', () => {
  it('applies as --pawbar-* properties, owner tokens win, and a change clears what it set', () => {
    const { target, props } = render({
      scheme: 'light',
      site: { accent: '#635bff', radius: 6, font: 'Inter' },
      tokens: { '--pawbar-radius': '14px' },
    });
    const wrap = q(target, '.frame-wrap')!;
    expect(wrap.style.getPropertyValue('--pawbar-accent')).toBe('#635bff');
    expect(wrap.style.getPropertyValue('--pawbar-font')).toBe('Inter, ui-sans-serif, system-ui, sans-serif');
    expect(wrap.style.getPropertyValue('--pawbar-radius')).toBe('14px');

    (props as Record<string, unknown>).site = {};
    (props as Record<string, unknown>).tokens = {};
    flushSync();
    expect(wrap.style.getPropertyValue('--pawbar-accent')).toBe('');
    expect(wrap.style.getPropertyValue('--pawbar-font')).toBe('');
    expect(wrap.style.getPropertyValue('--pawbar-radius')).toBe('');
  });

  it("the site's corners are the bar's when the owner set none", () => {
    const { target } = render({ site: { radius: 4 } });
    expect(q(target, '.frame-wrap')!.style.getPropertyValue('--pawbar-radius')).toBe('4px');
  });

  it('only --pawbar-* keys get through', () => {
    expect(resolveTheme({ color: 'red', '--other': 'x', '--pawbar-fg': '#111' })).toEqual({
      '--pawbar-fg': '#111',
    });
  });
});

describe('poweredBy and expandable', () => {
  it('the credit and the full screen toggle go when the owner turns them off', async () => {
    const msgs = [{ id: 'u1', role: 'user', content: 'hi', status: 'done' }];
    const on = render({ expanded: true, messages: msgs });
    expect(on.target.textContent).toContain('Paw Sites');
    expect(q(on.target, 'button[aria-label*="ull screen"]')).not.toBeNull();
    if (live) unmount(live);
    live = null;
    document.body.innerHTML = '';

    const off = render({ expanded: true, messages: msgs, poweredBy: false, expandable: false });
    expect(off.target.textContent).not.toContain('Paw Sites');
    expect(q(off.target, 'button[aria-label*="ull screen"]')).toBeNull();
  });
});
