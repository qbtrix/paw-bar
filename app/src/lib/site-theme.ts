// lib/site-theme.ts — the website's own look, as the bar wears it.
//
// The bar follows the site it is embedded in. The LOADER reads the host page
// (accent, page background and text colour, font, Google Fonts sheet, button
// radius; see detectSiteTheme in loader/src/loader.ts) and hands it over two
// ways: in the frame URL fragment `#t=<base64url JSON>` for the first paint,
// and as {pawbar:site-theme, theme} when it changes. In the owner preview the
// same message comes from the scene iframe running the loader in
// `?pawbar=sniff` mode. Both arrive here.
//
// UNTRUSTED. Whatever posts it, this is a stranger's page describing itself,
// so readSiteTheme keeps only: #rrggbb colours, a radius clamped to 0–32, a
// font family matching FONT_RE, and a stylesheet URL under
// https://fonts.googleapis.com/css. Anything else is dropped, facet by facet.
//
// LAYERING (lowest to highest), done by resolveTheme in lib/bar-themes:
//   bar defaults (incl. the light/dark overlay) < site theme < owner `tokens`
//   < owner `tokensDark` (dark only).
// siteTokens maps the theme to --pawbar-* values with two guards:
//   - bg/fg land only as a pair, only when they read at 4.5:1, and only when
//     the site's background is the same way round as the scheme the bar
//     resolved (an owner who pinned light on a dark site keeps a light bar).
//     The pill and the frame keep the default's glass alpha.
//   - the accent must reach 3:1 against the resolved pill background to drive
//     buttons (--pawbar-accent + a black/white --pawbar-accent-fg). Below that
//     it still marks the logo (--pawbar-brand) and the focus ring, and primary
//     buttons keep the bar's own accent. An owner accent beats all of it.

export interface SiteTheme {
  accent?: string;
  bg?: string;
  fg?: string;
  font?: string;
  fontHref?: string;
  radius?: number;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
export const FONT_RE = /^[\w\s,'"-]{1,200}$/;
const FONT_HOST = 'https://fonts.googleapis.com/css';
/** The default glass: the pill rests at 0.78, the frame at 0.82 light / 0.55 dark. */
const PILL_ALPHA = 0.78;
const FRAME_ALPHA = { light: 0.82, dark: 0.55 };

const hex = (v: unknown): string => (typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : '');

/** Validate a theme from anywhere. Never throws; an unusable value is `{}`. */
export function readSiteTheme(raw: unknown): SiteTheme {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: SiteTheme = {};
  for (const k of ['accent', 'bg', 'fg'] as const) {
    const c = hex(r[k]);
    if (c) out[k] = c;
  }
  if (typeof r.font === 'string' && FONT_RE.test(r.font)) out.font = r.font.trim();
  if (typeof r.fontHref === 'string' && r.fontHref.startsWith(FONT_HOST)) out.fontHref = r.fontHref;
  if (typeof r.radius === 'number' && Number.isFinite(r.radius)) {
    out.radius = Math.min(32, Math.max(0, Math.round(r.radius)));
  }
  return out;
}

/** The loader's `#t=` fragment, decoded and validated. `{}` when absent or bad. */
export function siteThemeFromHash(hash: string): SiteTheme {
  const m = /^#t=([\w-]{1,4096})$/.exec(hash);
  if (!m) return {};
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return readSiteTheme(JSON.parse(json));
  } catch {
    return {};
  }
}

function rgb(c: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(c: string): number {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const withAlpha = (c: string, a: number) => `rgb(${rgb(c).join(' ')} / ${a})`;

/** Black or white, whichever reads better on `c`. */
const inkOn = (c: string) => (contrast(c, '#000000') >= contrast(c, '#ffffff') ? '#000000' : '#ffffff');

/** A family list that always ends in a generic, so a missing face degrades
 *  to the right kind of font rather than to Times. */
function fontStack(font: string): string {
  return /\b(sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif|cursive)\s*$/i.test(font)
    ? font
    : `${font}, ui-sans-serif, system-ui, sans-serif`;
}

/**
 * The --pawbar-* values the site theme contributes, under the owner's map
 * `owner` (tokens, plus tokensDark when dark): a facet the owner set is left
 * to the owner, and the accent guard measures against the owner's pill
 * background when they set one.
 */
export function siteTokens(
  site: SiteTheme,
  scheme: 'light' | 'dark' | undefined,
  owner: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  const mode = scheme ?? 'dark';
  const has = (k: string) => k in owner;

  let surface = hex(owner['--pawbar-bg']) || '#ffffff';
  const { bg, fg } = site;
  if (bg && fg && contrast(bg, fg) >= 4.5 && (luminance(bg) < 0.18) === (mode === 'dark')) {
    if (!has('--pawbar-bg')) {
      out['--pawbar-bg'] = withAlpha(bg, PILL_ALPHA);
      surface = bg;
    }
    if (!has('--pawbar-fg')) out['--pawbar-fg'] = fg;
    if (!has('--pawbar-frame-bg')) out['--pawbar-frame-bg'] = withAlpha(bg, FRAME_ALPHA[mode]);
    if (!has('--pawbar-frame-fg')) out['--pawbar-frame-fg'] = fg;
  }

  const accent = site.accent;
  if (accent && !has('--pawbar-accent')) {
    const ink = inkOn(accent);
    if (contrast(accent, surface) >= 3) {
      out['--pawbar-accent'] = accent;
      if (!has('--pawbar-accent-fg')) out['--pawbar-accent-fg'] = ink;
    } else {
      out['--pawbar-brand'] = accent;
      out['--pawbar-brand-fg'] = ink;
      if (!has('--pawbar-ring')) out['--pawbar-ring'] = accent;
    }
  }

  if (site.font && !has('--pawbar-font')) out['--pawbar-font'] = fontStack(site.font);
  if (site.radius !== undefined && !has('--pawbar-radius')) out['--pawbar-radius'] = `${site.radius}px`;
  return out;
}

const FONT_LINK_ID = 'pawbar-site-font';

/**
 * Load the site's Google Fonts sheet into this document, so the named face
 * actually exists in the frame. Silent on failure (a CSP that does not allow
 * fonts.googleapis.com, a network error): the stack then falls through to
 * the generic family. An empty or invalid href removes the link.
 */
export function loadSiteFont(href: string | undefined, doc: Document = document): void {
  const current = doc.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
  if (!href || !href.startsWith(FONT_HOST)) {
    current?.remove();
    return;
  }
  if (current?.getAttribute('href') === href) return;
  const link = current ?? doc.createElement('link');
  link.id = FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.onerror = () => {};
  link.setAttribute('href', href);
  if (!current) doc.head.append(link);
}
