// tests/preview-tokens.spec.ts — the live-restyle channel refuses to open unless
// BOTH gates pass.
//
// Created 2026-08-20, after a push-time security review flagged the first cut as
// fail-open. It read:
//
//     if (config.parentOrigin && event.origin !== config.parentOrigin) return;
//
// which skips the origin check entirely when parentOrigin is empty — and empty
// is a state that really happens (the backend's _safe_parent_origin returns ""
// when the dashboard origin fails sanitization; the dev config falls back to a
// referrer that may not be there). In that state any window holding a handle to
// the frame could set arbitrary CSS custom properties on the widget, url()
// values included.
//
// The property under test is therefore "did not install", not "installed and
// ignored it" — which is why the function returns null rather than a no-op
// teardown, and why these assert on the return value as well as on the effect.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installPreviewTokenListener } from '../src/lib/preview-tokens';
import { resetAppliedTokens } from '../src/lib/tokens';

const PARENT = 'https://dash.example.com';

function build(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'pawbar-root';
  const style = document.createElement('style');
  style.textContent = '.pawbar-root { --pawbar-accent: DEFAULT; }';
  document.head.append(style);
  document.body.append(root);
  return root;
}

const read = (el: HTMLElement) => getComputedStyle(el).getPropertyValue('--pawbar-accent').trim();

/** postMessage cannot forge event.origin in jsdom, so dispatch it directly. */
function post(origin: string, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { origin, data }));
}

const TOKENS = { '--pawbar-accent': '#ff5a36' };

let teardown: (() => void) | null = null;

beforeEach(() => resetAppliedTokens());
afterEach(() => {
  teardown?.();
  teardown = null;
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  document.body.replaceChildren();
});

describe('the preview token channel', () => {
  it('applies tokens from the declared parent origin', () => {
    const root = build();
    teardown = installPreviewTokenListener({
      preview: true,
      parentOrigin: PARENT,
      getRoot: () => root,
    });
    expect(teardown).not.toBeNull();

    post(PARENT, { type: 'pawbar:preview-tokens', tokens: TOKENS });

    expect(read(root)).toBe('#ff5a36');
  });

  it('REFUSES TO INSTALL when there is no parent origin', () => {
    const root = build();

    const t = installPreviewTokenListener({ preview: true, parentOrigin: '', getRoot: () => root });

    // The regression this file exists for. Not "installs and then ignores" —
    // nothing is listening at all, so there is no origin comparison to get wrong.
    expect(t).toBeNull();
    post('https://evil.test', { type: 'pawbar:preview-tokens', tokens: TOKENS });
    expect(read(root)).toBe('DEFAULT');
  });

  it('never installs on a public embed, whatever the origin', () => {
    const root = build();

    const t = installPreviewTokenListener({
      preview: false,
      parentOrigin: PARENT,
      getRoot: () => root,
    });

    // A public bar's parent IS the customer's page, so an origin check there
    // passes by construction and would gate nothing. The flag is the real gate.
    expect(t).toBeNull();
    post(PARENT, { type: 'pawbar:preview-tokens', tokens: TOKENS });
    expect(read(root)).toBe('DEFAULT');
  });

  it('ignores a message from any other origin', () => {
    const root = build();
    teardown = installPreviewTokenListener({
      preview: true,
      parentOrigin: PARENT,
      getRoot: () => root,
    });

    post('https://evil.test', { type: 'pawbar:preview-tokens', tokens: TOKENS });

    expect(read(root)).toBe('DEFAULT');
  });

  it('does not treat a look-alike origin as the parent', () => {
    const root = build();
    teardown = installPreviewTokenListener({
      preview: true,
      parentOrigin: PARENT,
      getRoot: () => root,
    });

    // Shares a prefix with the real origin — an exact comparison is the point.
    post(`${PARENT}.evil.test`, { type: 'pawbar:preview-tokens', tokens: TOKENS });

    expect(read(root)).toBe('DEFAULT');
  });

  it('ignores messages that are not preview tokens', () => {
    const root = build();
    teardown = installPreviewTokenListener({
      preview: true,
      parentOrigin: PARENT,
      getRoot: () => root,
    });

    post(PARENT, { type: 'pawbar:box', tokens: TOKENS });
    post(PARENT, { type: 'pawbar:preview-tokens', tokens: ['--pawbar-accent', '#000'] });
    post(PARENT, { type: 'pawbar:preview-tokens', tokens: 'accent' });
    post(PARENT, null);

    expect(read(root)).toBe('DEFAULT');
  });
});
