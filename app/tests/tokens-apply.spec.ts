// tests/tokens-apply.spec.ts — applyTokens replaces, rather than accumulates.
//
// Created 2026-08-20, alongside live restyling in the owner preview.
//
// Sibling of tokens.spec.ts, which pins WHERE the overrides must land (the root,
// not the parent). This one pins what happens on the SECOND call, which only
// started happening when the appearance editor began repainting the preview on
// every edit.
//
// The failure it exists for is one-directional and therefore easy to miss: set
// an accent, then clear it. Applying is obviously tested by any happy path;
// UN-applying is not, and if the old declaration survives, the bar stays the
// colour the owner just deleted. Every subsequent edit still works, so the
// preview looks alive — it is simply wrong about one value, permanently, until
// a reload.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyTokens, resetAppliedTokens } from '../src/lib/tokens';

function build(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'pawbar-root';
  const style = document.createElement('style');
  // What tokens.css does: the scale is declared on the root itself.
  style.textContent = '.pawbar-root { --pawbar-accent: DEFAULT; --pawbar-radius: 20px; }';
  document.head.append(style);
  document.body.append(root);
  return root;
}

const read = (el: HTMLElement, k: string) => getComputedStyle(el).getPropertyValue(k).trim();

beforeEach(() => resetAppliedTokens());
afterEach(() => {
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  document.body.replaceChildren();
});

describe('applyTokens', () => {
  it('applies a map to the root', () => {
    const root = build();
    applyTokens(root, { '--pawbar-accent': '#ff5a36' });
    expect(read(root, '--pawbar-accent')).toBe('#ff5a36');
  });

  it('normalizes a bare key onto the --pawbar- prefix', () => {
    const root = build();
    applyTokens(root, { accent: '#00ccaa' });
    expect(read(root, '--pawbar-accent')).toBe('#00ccaa');
  });

  it('RETRACTS a token that the next map omits', () => {
    const root = build();
    applyTokens(root, { '--pawbar-accent': '#ff5a36', '--pawbar-radius': '8px' });
    expect(read(root, '--pawbar-accent')).toBe('#ff5a36');

    // The owner cleared the accent; the map no longer carries it.
    applyTokens(root, { '--pawbar-radius': '8px' });

    // It must fall back to the stylesheet, NOT stay on the deleted colour.
    expect(read(root, '--pawbar-accent')).toBe('DEFAULT');
    expect(read(root, '--pawbar-radius')).toBe('8px');
  });

  it('leaves properties it never set alone', () => {
    const root = build();
    // Something else owns this one — the retraction must not sweep it up.
    root.style.setProperty('--pawbar-blur', '12px');

    applyTokens(root, { '--pawbar-accent': '#ff5a36' });
    applyTokens(root, {});

    expect(read(root, '--pawbar-blur')).toBe('12px');
    expect(read(root, '--pawbar-accent')).toBe('DEFAULT');
  });

  it('an empty map clears everything it applied', () => {
    const root = build();
    applyTokens(root, { '--pawbar-accent': '#ff5a36', '--pawbar-radius': '4px' });
    applyTokens(root, {});
    expect(read(root, '--pawbar-accent')).toBe('DEFAULT');
    expect(read(root, '--pawbar-radius')).toBe('20px');
  });
});
