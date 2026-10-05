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
//
// The last block covers the dark set: `tokensDark` in the message goes over
// `tokens` while the root is marked data-pawbar-scheme="dark", and a flip of
// that attribute repaints without a new message.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installPreviewConfigListener, installPreviewTokenListener } from '../src/lib/preview-tokens';
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

describe('the preview token channel, light and dark', () => {
  const DARK = { '--pawbar-accent': '#00ccaa' };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('applies tokensDark over tokens while the root reads dark', () => {
    const root = build();
    root.setAttribute('data-pawbar-scheme', 'dark');
    teardown = installPreviewTokenListener({ preview: true, parentOrigin: PARENT, getRoot: () => root });

    post(PARENT, { type: 'pawbar:preview-tokens', tokens: TOKENS, tokensDark: DARK });

    expect(read(root)).toBe('#00ccaa');
  });

  it('follows a scheme flip without a new message, and drops the dark values on light', async () => {
    const root = build();
    root.setAttribute('data-pawbar-scheme', 'light');
    teardown = installPreviewTokenListener({ preview: true, parentOrigin: PARENT, getRoot: () => root });
    post(PARENT, { type: 'pawbar:preview-tokens', tokens: TOKENS, tokensDark: DARK });
    expect(read(root)).toBe('#ff5a36');

    root.setAttribute('data-pawbar-scheme', 'dark');
    await flush();
    expect(read(root)).toBe('#00ccaa');

    root.setAttribute('data-pawbar-scheme', 'light');
    await flush();
    expect(read(root)).toBe('#ff5a36');
  });

  it('a dark-only key is removed on light, so the stylesheet default returns', async () => {
    const root = build();
    root.setAttribute('data-pawbar-scheme', 'dark');
    teardown = installPreviewTokenListener({ preview: true, parentOrigin: PARENT, getRoot: () => root });
    post(PARENT, { type: 'pawbar:preview-tokens', tokens: {}, tokensDark: DARK });
    expect(read(root)).toBe('#00ccaa');

    root.setAttribute('data-pawbar-scheme', 'light');
    await flush();
    expect(read(root)).toBe('DEFAULT');
  });

  it('an editor that sends no usable tokensDark still paints tokens on dark', () => {
    const root = build();
    root.setAttribute('data-pawbar-scheme', 'dark');
    teardown = installPreviewTokenListener({ preview: true, parentOrigin: PARENT, getRoot: () => root });

    post(PARENT, { type: 'pawbar:preview-tokens', tokens: TOKENS, tokensDark: ['x'] });

    expect(read(root)).toBe('#ff5a36');
  });

  it('stops following the scheme after teardown', async () => {
    const root = build();
    root.setAttribute('data-pawbar-scheme', 'light');
    teardown = installPreviewTokenListener({ preview: true, parentOrigin: PARENT, getRoot: () => root });
    post(PARENT, { type: 'pawbar:preview-tokens', tokens: TOKENS, tokensDark: DARK });
    teardown?.();
    teardown = null;

    root.setAttribute('data-pawbar-scheme', 'dark');
    await flush();
    expect(read(root)).toBe('#ff5a36');
  });
});

// ── pawbar:preview-config ───────────────────────────────────────────────────
// The editor's whole draft (owner settings, not just tokens). Same two gates,
// same "did not install" property, and every value normalised the way the
// boot config is, so a draft cannot smuggle a script URL into the logo.
describe('the preview config channel', () => {
  const install = (over: Partial<{ preview: boolean; parentOrigin: string }> = {}) => {
    const apply = vi.fn();
    teardown = installPreviewConfigListener({ preview: true, parentOrigin: PARENT, apply, ...over });
    return apply;
  };

  it('applies the draft from the declared parent origin, only the keys it carries', () => {
    const apply = install();
    post(PARENT, {
      type: 'pawbar:preview-config',
      config: { launcher: 'icon', side: 'left', poweredBy: false, tokens: { '--pawbar-accent': '#ff5a36' } },
    });
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0]).toEqual({
      launcher: 'icon',
      side: 'left',
      poweredBy: false,
      tokens: { '--pawbar-accent': '#ff5a36' },
    });
  });

  it('normalises like the boot config', () => {
    const apply = install();
    post(PARENT, {
      type: 'pawbar:preview-config',
      config: { logo: 'javascript:alert(1)', barSize: 'xl', expandable: 'no', disclosure: ' x '.repeat(100) },
    });
    const patch = apply.mock.calls[0][0];
    expect(patch.logo).toBe('');
    expect(patch.barSize).toBe('sm');
    expect(patch.expandable).toBe(true);
    expect(patch.disclosure.length).toBeLessThanOrEqual(140);
  });

  it('REFUSES TO INSTALL without a parent origin, or outside the preview', () => {
    expect(installPreviewConfigListener({ preview: true, parentOrigin: '', apply: vi.fn() })).toBeNull();
    expect(installPreviewConfigListener({ preview: false, parentOrigin: PARENT, apply: vi.fn() })).toBeNull();
  });

  it('ignores other origins, look-alikes, other types and a non-object config', () => {
    const apply = install();
    const msg = { type: 'pawbar:preview-config', config: { voice: false } };
    post('https://evil.example.com', msg);
    post(PARENT + '.evil.test', msg);
    post(PARENT, { ...msg, type: 'pawbar:preview-tokens' });
    post(PARENT, { type: 'pawbar:preview-config', config: ['voice'] });
    post(PARENT, { type: 'pawbar:preview-config' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('the token channel keeps working beside it', () => {
    install();
    const root = build();
    const tokens = installPreviewTokenListener({ preview: true, parentOrigin: PARENT, getRoot: () => root });
    post(PARENT, { type: 'pawbar:preview-tokens', tokens: TOKENS });
    expect(root.style.getPropertyValue('--pawbar-accent')).toBe('#ff5a36');
    tokens?.();
  });
});
