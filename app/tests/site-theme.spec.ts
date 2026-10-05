// tests/site-theme.spec.ts — the website's look, as the bar wears it.
// readSiteTheme keeps only what is safe (hex colours, a clamped radius, a
// plain font family, a Google Fonts stylesheet URL); resolveTheme layers
// defaults < site < owner tokens < owner tokensDark; siteTokens keeps the
// pill's glass alpha, applies bg/fg only as a readable pair on the matching
// scheme, and demotes an accent that fails 3:1 against the bar background to
// the logo and focus ring. loadSiteFont links the sheet once, and only from
// fonts.googleapis.com.

import { describe, it, expect, afterEach } from 'vitest';
import {
  contrast,
  loadSiteFont,
  readSiteTheme,
  siteThemeFromHash,
  siteTokens,
} from '../src/lib/site-theme';
import { resolveTheme } from '../src/lib/bar-themes';

describe('readSiteTheme: untrusted input', () => {
  it('keeps valid facets and lowercases colours', () => {
    expect(
      readSiteTheme({
        accent: '#635BFF',
        bg: '#ffffff',
        fg: '#111111',
        font: '"Inter", sans-serif',
        fontHref: 'https://fonts.googleapis.com/css2?family=Inter',
        radius: 8,
      }),
    ).toEqual({
      accent: '#635bff',
      bg: '#ffffff',
      fg: '#111111',
      font: '"Inter", sans-serif',
      fontHref: 'https://fonts.googleapis.com/css2?family=Inter',
      radius: 8,
    });
  });

  it('drops anything that is not a #rrggbb colour', () => {
    for (const bad of ['red', '#fff', 'rgb(1,2,3)', 'url(https://x.test/a.png)', '#12345g', 12]) {
      expect(readSiteTheme({ accent: bad })).toEqual({});
    }
  });

  it('clamps the radius to 0–32 and drops a non-number', () => {
    expect(readSiteTheme({ radius: 400 }).radius).toBe(32);
    expect(readSiteTheme({ radius: -4 }).radius).toBe(0);
    expect(readSiteTheme({ radius: 7.6 }).radius).toBe(8);
    expect(readSiteTheme({ radius: '8px' })).toEqual({});
    expect(readSiteTheme({ radius: Infinity })).toEqual({});
  });

  it('refuses a font family that could escape the declaration', () => {
    expect(readSiteTheme({ font: 'Inter; background: url(x)' })).toEqual({});
    expect(readSiteTheme({ font: 'Inter}' })).toEqual({});
    expect(readSiteTheme({ font: 'x'.repeat(201) })).toEqual({});
  });

  it('takes a font sheet only from fonts.googleapis.com/css', () => {
    expect(readSiteTheme({ fontHref: 'https://fonts.googleapis.com.evil.test/css' })).toEqual({});
    expect(readSiteTheme({ fontHref: 'http://fonts.googleapis.com/css2?family=Inter' })).toEqual({});
    expect(readSiteTheme({ fontHref: 'https://evil.test/?https://fonts.googleapis.com/css' })).toEqual({});
  });

  it('is {} for anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 3, ['#ffffff']]) expect(readSiteTheme(bad)).toEqual({});
  });

  it('decodes a base64url fragment, UTF-8 included', () => {
    const json = JSON.stringify({ font: 'Noto Sans', accent: '#ff5a36' });
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(siteThemeFromHash('#t=' + b64)).toEqual({ font: 'Noto Sans', accent: '#ff5a36' });
    expect(siteThemeFromHash('#other')).toEqual({});
    expect(siteThemeFromHash('')).toEqual({});
  });
});

describe('layering', () => {
  const site = { accent: '#1d4ed8', radius: 6 };

  it('the site theme goes over the defaults', () => {
    const vars = resolveTheme({}, 'light', {}, site);
    expect(vars['--pawbar-accent']).toBe('#1d4ed8');
    expect(vars['--pawbar-radius']).toBe('6px');
    // The default's light overlay is still there underneath.
    expect(vars['--pawbar-frame-fg']).toBe('#1c1c21');
  });

  it('owner tokens go over the site theme, and the dark set over those on dark', () => {
    const tokens = { '--pawbar-accent': '#0f766e', '--pawbar-radius': '20px' };
    const dark = { '--pawbar-accent': '#5eead4' };
    expect(resolveTheme(tokens, 'light', dark, site)['--pawbar-accent']).toBe('#0f766e');
    expect(resolveTheme(tokens, 'light', dark, site)['--pawbar-radius']).toBe('20px');
    expect(resolveTheme(tokens, 'dark', dark, site)['--pawbar-accent']).toBe('#5eead4');
  });

  it('an owner accent also keeps the site from setting the accent ink', () => {
    const vars = resolveTheme({ '--pawbar-accent': '#0f766e' }, 'light', {}, site);
    expect(vars['--pawbar-accent-fg']).toBeUndefined();
  });
});

describe('siteTokens', () => {
  it('picks a black or white ink for the accent by contrast', () => {
    expect(siteTokens({ accent: '#1d4ed8' }, 'light')['--pawbar-accent-fg']).toBe('#ffffff');
    expect(siteTokens({ accent: '#facc15' }, 'dark', { '--pawbar-bg': '#111111' })['--pawbar-accent-fg']).toBe('#000000');
  });

  it("an owner's accent ink wins", () => {
    expect(siteTokens({ accent: '#1d4ed8' }, 'light', { '--pawbar-accent-fg': '#eeeeee' })['--pawbar-accent-fg']).toBeUndefined();
  });

  it('a faint accent marks the logo and the ring, and buttons keep the bar accent', () => {
    // Pale yellow on the white pill: about 1.3:1.
    const out = siteTokens({ accent: '#fde68a' }, 'light');
    expect(contrast('#fde68a', '#ffffff')).toBeLessThan(3);
    expect(out['--pawbar-accent']).toBeUndefined();
    expect(out['--pawbar-brand']).toBe('#fde68a');
    expect(out['--pawbar-ring']).toBe('#fde68a');
  });

  it('measures the accent against the site background once that applies', () => {
    // Pale yellow on a dark site page reads fine.
    const out = siteTokens({ accent: '#fde68a', bg: '#0e1117', fg: '#e6e6e6' }, 'dark');
    expect(out['--pawbar-accent']).toBe('#fde68a');
    expect(out['--pawbar-brand']).toBeUndefined();
  });

  it('keeps the glass: the page colour lands with the default alpha', () => {
    const light = siteTokens({ bg: '#fafaf9', fg: '#1c1917' }, 'light');
    expect(light['--pawbar-bg']).toBe('rgb(250 250 249 / 0.78)');
    expect(light['--pawbar-frame-bg']).toBe('rgb(250 250 249 / 0.82)');
    expect(light['--pawbar-fg']).toBe('#1c1917');
    expect(light['--pawbar-frame-fg']).toBe('#1c1917');
    const dark = siteTokens({ bg: '#0e1117', fg: '#e6e6e6' }, 'dark');
    expect(dark['--pawbar-frame-bg']).toBe('rgb(14 17 23 / 0.55)');
  });

  it('page colours apply only as a readable pair, on the matching scheme', () => {
    // No fg: a dark pill under the default dark ink would be unreadable.
    expect(siteTokens({ bg: '#0e1117' }, 'dark')['--pawbar-bg']).toBeUndefined();
    // Too little contrast between them.
    expect(siteTokens({ bg: '#777777', fg: '#888888' }, 'light')['--pawbar-bg']).toBeUndefined();
    // A dark site, but the owner pinned the bar light.
    expect(siteTokens({ bg: '#0e1117', fg: '#e6e6e6' }, 'light')['--pawbar-bg']).toBeUndefined();
  });

  it('font gets a generic fallback unless it already ends in one', () => {
    expect(siteTokens({ font: 'Inter' }, 'light')['--pawbar-font']).toBe('Inter, ui-sans-serif, system-ui, sans-serif');
    expect(siteTokens({ font: 'Georgia, serif' }, 'light')['--pawbar-font']).toBe('Georgia, serif');
  });
});

describe('loadSiteFont', () => {
  afterEach(() => document.head.replaceChildren());
  const links = () => document.head.querySelectorAll('link#pawbar-site-font');

  it('links a Google Fonts sheet once, swaps it, and removes it', () => {
    loadSiteFont('https://fonts.googleapis.com/css2?family=Inter');
    loadSiteFont('https://fonts.googleapis.com/css2?family=Inter');
    expect(links()).toHaveLength(1);
    expect(links()[0].getAttribute('rel')).toBe('stylesheet');
    loadSiteFont('https://fonts.googleapis.com/css2?family=Lora');
    expect(links()).toHaveLength(1);
    expect(links()[0].getAttribute('href')).toBe('https://fonts.googleapis.com/css2?family=Lora');
    loadSiteFont(undefined);
    expect(links()).toHaveLength(0);
  });

  it('never links anything else', () => {
    loadSiteFont('https://evil.test/font.css');
    expect(links()).toHaveLength(0);
  });
});
