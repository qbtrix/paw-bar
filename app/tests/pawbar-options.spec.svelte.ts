// tests/pawbar-options.spec.svelte.ts — the bar's owner and visitor options
// (2026-09-27): the ⋯ size menu (the visitor's pick is stored and beats the
// site default), full screen (a menu item; Escape leaves it before closing
// anything), the icon launcher (click-only, ✕ to close), and theme presets
// (applied as --pawbar-* properties, cleared when switching), and the owner's
// corner `radius`, which beats the theme's and is clamped to 0–40px.

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
import { BAR_THEMES, resolveTheme } from '../src/lib/bar-themes';

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
  const props = $state({ messages: [], onsend: vi.fn(), ...extra });
  live = mount(PawBarFrame, { target, props });
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
    const { target } = render({ size: 'md' });
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
    const again = render({ size: 'lg' });
    expect(q(again.target, '.pawbar-host')!.dataset.size).toBe('sm');
  });

  it('ignores a stored value that is not a size', () => {
    localStorage.setItem(SIZE_KEY, 'huge');
    const { target } = render({ size: 'lg' });
    expect(q(target, '.pawbar-host')!.dataset.size).toBe('lg');
  });

  it('resizable={false} removes the menu', () => {
    const { target } = render({ resizable: false });
    expect(q(target, 'button[aria-label="Chat options"]')).toBeNull();
  });
});

describe('full screen', () => {
  it('turns on from the menu and Escape leaves it before closing the card', async () => {
    const { target } = render();
    await openMenu(target);
    q<HTMLButtonElement>(target, '.menu-item[role="menuitemcheckbox"]')!.click();
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

describe('themes', () => {
  it('applies the preset as --pawbar-* properties, overrides win, a switch clears', () => {
    const { target, props } = render({ theme: 'indigo', tokens: { '--pawbar-accent': '#ff0000' } });
    const wrap = q(target, '.frame-wrap')!;
    expect(wrap.style.getPropertyValue('--pawbar-fg')).toBe(BAR_THEMES.indigo.vars['--pawbar-fg']);
    expect(wrap.style.getPropertyValue('--pawbar-accent')).toBe('#ff0000');

    (props as Record<string, unknown>).theme = 'default';
    (props as Record<string, unknown>).tokens = {};
    flushSync();
    expect(wrap.style.getPropertyValue('--pawbar-fg')).toBe('');
    expect(wrap.style.getPropertyValue('--pawbar-accent')).toBe('');
  });

  it('only --pawbar-* keys get through, and unknown themes are the default', () => {
    expect(resolveTheme('nope')).toEqual({});
    expect(resolveTheme('default', { color: 'red', '--other': 'x', '--pawbar-fg': '#111' })).toEqual({
      '--pawbar-fg': '#111',
    });
  });
});

describe('owner radius', () => {
  it("beats the theme's radius, is clamped, and clears when unset", () => {
    const { target, props } = render({ theme: 'indigo', radius: 30 });
    const wrap = q(target, '.frame-wrap')!;
    expect(BAR_THEMES.indigo.vars['--pawbar-radius']).toBe('8px');
    expect(wrap.style.getPropertyValue('--pawbar-radius')).toBe('30px');

    (props as Record<string, unknown>).radius = 400;
    flushSync();
    expect(wrap.style.getPropertyValue('--pawbar-radius')).toBe('40px');

    (props as Record<string, unknown>).radius = -5;
    flushSync();
    expect(wrap.style.getPropertyValue('--pawbar-radius')).toBe('0px');

    (props as Record<string, unknown>).radius = undefined;
    flushSync();
    expect(wrap.style.getPropertyValue('--pawbar-radius')).toBe('8px');
  });
});
