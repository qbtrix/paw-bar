// bar-themes.ts — preset themes for the fresh bar components (2026-09-27).
//
// A theme is nothing but a set of --pawbar-* values. The components read every
// colour, radius, blur and font through `var(--pawbar-x, <fallback>)`, so a
// theme is applied by setting those properties on the frame's wrapper, and the
// fallbacks ARE the "default" theme.
//
// Each preset takes its cues from the chrome of a well-known product site (its
// surfaces, ink, borders, primary button and corner language). They are named
// for the STYLE, not the brand, so a customer's widget never reads as if it
// were made by, or affiliated with, the company whose look it borrows. The
// `inspiredBy` field is for the owner's picker and for us; it is never drawn
// on a visitor's page.
//
// No theme sets the credit colour: the credit wears the frame's own colours
// on a pill (see PawBarFrame), because the host page behind it is unknowable.
//
// 2026-09-27 (host scheme): a theme may carry `light` / `dark` overlays, and
// only Default does, because its fallbacks are a mixed pair (a light pill on
// a dark glass frame) that vanishes on a white page. `resolveTheme` takes the
// scheme the host resolved and layers: vars, then the scheme overlay, then
// the owner's tokens. Branded themes declare no overlay and ignore the
// scheme: an owner who picked Paper for a dark storefront wants Paper.
//
// Fonts name the site's face first and fall back to system faces. The widget
// does not load web fonts, so the named face only applies where the host page
// (or the visitor's machine) already has it.

export type BarThemeId = 'default' | 'midnight' | 'geist' | 'indigo' | 'paper' | 'glass';

export type BarScheme = 'light' | 'dark';

export interface BarTheme {
  label: string;
  inspiredBy: string;
  vars: Record<string, string>;
  light?: Record<string, string>;
  dark?: Record<string, string>;
}

export const BAR_THEMES: Record<BarThemeId, BarTheme> = {
  default: {
    label: 'Default',
    inspiredBy: '',
    vars: {},
    // Dark is the components' own fallbacks, so it needs no values.
    dark: {},
    light: {
      '--pawbar-frame-bg': 'rgb(250 250 252 / 0.82)',
      '--pawbar-frame-fg': '#1c1c21',
      '--pawbar-frame-border': 'rgb(0 0 0 / 0.08)',
      '--pawbar-bubble-bg': '#1c1c21',
      '--pawbar-bubble-fg': '#fafafa',
      '--pawbar-border': 'rgb(0 0 0 / 0.08)',
      '--pawbar-scrim': 'rgb(250 250 252 / 0.5)',
    },
  },
  // Near-black layered surfaces, hairline borders, a light-grey primary.
  midnight: {
    label: 'Midnight',
    inspiredBy: 'Linear',
    vars: {
      '--pawbar-font': "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif",
      '--pawbar-bg': 'rgb(22 23 26 / 0.9)',
      '--pawbar-fg': '#f7f8f8',
      '--pawbar-muted': '#8a8f98',
      '--pawbar-border': 'rgb(255 255 255 / 0.08)',
      '--pawbar-accent': '#e6e6e6',
      '--pawbar-accent-fg': '#08090a',
      '--pawbar-radius': '12px',
      '--pawbar-frame-bg': 'rgb(8 9 10 / 0.78)',
      '--pawbar-frame-fg': '#f7f8f8',
      '--pawbar-frame-border': 'rgb(255 255 255 / 0.08)',
      '--pawbar-bubble-bg': '#26282c',
      '--pawbar-bubble-fg': '#f7f8f8',
      '--pawbar-menu-bg': 'rgb(28 29 32 / 0.97)',
      '--pawbar-scrim': 'rgb(0 0 0 / 0.55)',
    },
  },
  // Pure white and near-black, grey hairlines, a black primary.
  geist: {
    label: 'Geist',
    inspiredBy: 'Vercel',
    vars: {
      '--pawbar-font': "Geist, 'Geist Sans', Inter, ui-sans-serif, system-ui, sans-serif",
      '--pawbar-bg': '#ffffff',
      '--pawbar-fg': '#171717',
      '--pawbar-muted': '#8f8f8f',
      '--pawbar-border': '#ebebeb',
      '--pawbar-accent': '#171717',
      '--pawbar-accent-fg': '#ffffff',
      '--pawbar-radius': '12px',
      '--pawbar-frame-bg': 'rgb(250 250 250 / 0.92)',
      '--pawbar-frame-fg': '#171717',
      '--pawbar-frame-border': '#ebebeb',
      '--pawbar-bubble-bg': '#171717',
      '--pawbar-bubble-fg': '#ffffff',
      '--pawbar-menu-bg': '#ffffff',
      '--pawbar-scrim': 'rgb(250 250 250 / 0.55)',
    },
  },
  // Navy ink on white, cool grey lines, the violet-indigo primary.
  indigo: {
    label: 'Indigo',
    inspiredBy: 'Stripe',
    vars: {
      '--pawbar-font': "sohne-var, 'Söhne', 'Helvetica Neue', ui-sans-serif, system-ui, sans-serif",
      '--pawbar-bg': '#ffffff',
      '--pawbar-fg': '#0a2540',
      '--pawbar-muted': '#6b7c93',
      '--pawbar-border': '#e3e8ee',
      '--pawbar-accent': '#635bff',
      '--pawbar-accent-fg': '#ffffff',
      '--pawbar-ring': '#635bff',
      '--pawbar-radius': '8px',
      '--pawbar-frame-bg': 'rgb(246 249 252 / 0.94)',
      '--pawbar-frame-fg': '#0a2540',
      '--pawbar-frame-border': '#e3e8ee',
      '--pawbar-bubble-bg': '#635bff',
      '--pawbar-bubble-fg': '#ffffff',
      '--pawbar-menu-bg': '#ffffff',
      '--pawbar-scrim': 'rgb(10 37 64 / 0.3)',
    },
  },
  // Warm off-white paper, soft brown-grey ink, the blue link primary.
  paper: {
    label: 'Paper',
    inspiredBy: 'Notion',
    vars: {
      '--pawbar-font': "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
      '--pawbar-bg': '#ffffff',
      '--pawbar-fg': '#37352f',
      '--pawbar-muted': '#9b9a97',
      '--pawbar-border': 'rgb(55 53 47 / 0.16)',
      '--pawbar-accent': '#2383e2',
      '--pawbar-accent-fg': '#ffffff',
      '--pawbar-ring': '#2383e2',
      '--pawbar-radius': '8px',
      '--pawbar-frame-bg': 'rgb(251 251 250 / 0.96)',
      '--pawbar-frame-fg': '#37352f',
      '--pawbar-frame-border': 'rgb(55 53 47 / 0.12)',
      '--pawbar-bubble-bg': '#f1f1ef',
      '--pawbar-bubble-fg': '#37352f',
      '--pawbar-menu-bg': '#ffffff',
      '--pawbar-scrim': 'rgb(55 53 47 / 0.25)',
    },
  },
  // Heavy frosted translucency, graphite ink, the system blue primary.
  glass: {
    label: 'Glass',
    inspiredBy: 'Apple',
    vars: {
      '--pawbar-font': "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', ui-sans-serif, system-ui, sans-serif",
      '--pawbar-bg': 'rgb(255 255 255 / 0.66)',
      '--pawbar-fg': '#1d1d1f',
      '--pawbar-muted': '#6e6e73',
      '--pawbar-border': 'rgb(255 255 255 / 0.55)',
      '--pawbar-accent': '#0071e3',
      '--pawbar-accent-fg': '#ffffff',
      '--pawbar-ring': '#0071e3',
      '--pawbar-blur': '28px',
      '--pawbar-frame-bg': 'rgb(255 255 255 / 0.55)',
      '--pawbar-frame-fg': '#1d1d1f',
      '--pawbar-frame-border': 'rgb(255 255 255 / 0.5)',
      '--pawbar-bubble-bg': '#0071e3',
      '--pawbar-bubble-fg': '#ffffff',
      '--pawbar-menu-bg': 'rgb(255 255 255 / 0.85)',
      '--pawbar-scrim': 'rgb(255 255 255 / 0.2)',
    },
  },
};

export const BAR_THEME_IDS = Object.keys(BAR_THEMES) as BarThemeId[];

/** The properties a theme plus owner overrides resolve to. Only --pawbar-*
 *  keys survive, so an override map cannot reach anything but the widget's own
 *  tokens. Unknown theme ids fall back to the default (no properties). The
 *  scheme overlay sits between the theme and the owner's tokens. */
export function resolveTheme(
  id: string,
  overrides: Record<string, string> = {},
  scheme?: BarScheme,
): Record<string, string> {
  const theme = BAR_THEMES[id as BarThemeId];
  const base = theme?.vars ?? {};
  const overlay = (scheme && theme?.[scheme]) || {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...base, ...overlay, ...overrides })) {
    if (k.startsWith('--pawbar-') && typeof v === 'string') out[k] = v;
  }
  return out;
}
