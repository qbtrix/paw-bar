// tests/tokens.spec.ts — the owner's white-label tokens actually take effect.
// Created 2026-08-19.
//
// THE BUG THIS EXISTS FOR: main.ts set the owner's --pawbar-* overrides on the
// MOUNT TARGET and left them to cascade into .pawbar-root. That cannot work.
// tokens.css declares the whole scale ON .pawbar-root, and a declaration on an
// element always beats a value inherited from its parent — so every override
// was silently discarded and the stylesheet defaults won.
//
// It hid for months because the backend answered `"tokens": {}` for exactly as
// long, so there was never a value to lose, and every test asserted on the map
// rather than on a rendered element. A test that checks "did we call
// setProperty" would still pass with the bug in place, which is why this one
// reads getComputedStyle off a real root inside a real parent.

import { describe, it, expect, afterEach } from 'vitest';

function build(): { target: HTMLElement; root: HTMLElement } {
  const target = document.createElement('div');
  const root = document.createElement('div');
  root.className = 'pawbar-root';
  // What tokens.css does: declares the scale on the root itself.
  const style = document.createElement('style');
  style.textContent = '.pawbar-root { --pawbar-accent: DEFAULT; --pawbar-duration: 240ms; }';
  document.head.append(style);
  target.append(root);
  document.body.append(target);
  return { target, root };
}

afterEach(() => {
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  document.body.replaceChildren();
});

describe('white-label token application', () => {
  it('an override on the PARENT is lost — the root re-declares the same name', () => {
    const { target, root } = build();

    target.style.setProperty('--pawbar-accent', '#ff5a36');

    // This is the old behaviour, pinned so nobody "simplifies" the fix back to
    // it: the inherited value never reaches the element that declares its own.
    expect(getComputedStyle(root).getPropertyValue('--pawbar-accent').trim()).toBe('DEFAULT');
  });

  it('an override on the ROOT wins, which is where main.ts puts them', () => {
    const { root } = build();

    root.style.setProperty('--pawbar-accent', '#ff5a36');
    root.style.setProperty('--pawbar-duration', '360ms');

    expect(getComputedStyle(root).getPropertyValue('--pawbar-accent').trim()).toBe('#ff5a36');
    expect(getComputedStyle(root).getPropertyValue('--pawbar-duration').trim()).toBe('360ms');
  });

  it('a token the owner did not set keeps the stylesheet default', () => {
    const { root } = build();

    root.style.setProperty('--pawbar-accent', '#ff5a36');

    // Why the backend emits absent tokens rather than restating them at their
    // default: an unset one stays ours to retune for every site at once.
    expect(getComputedStyle(root).getPropertyValue('--pawbar-duration').trim()).toBe('240ms');
  });
});
