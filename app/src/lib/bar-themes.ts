// bar-themes.ts — the bar's own defaults and the theme layering.
//
// A theme is nothing but a set of --pawbar-* values. The components read every
// colour, radius, blur and font through `var(--pawbar-x, <fallback>)`, so the
// fallbacks ARE the bar's defaults, and anything layered here is applied as
// those properties on the frame's wrapper.
//
// There are no owner-facing presets. The bar follows the WEBSITE's look
// (lib/site-theme), and the owner overrides it facet by facet with `tokens`.
// What is left here is the default's light/dark overlay: its fallbacks are a
// mixed pair (a light pill on a dark glass frame) that vanishes on a white
// page, so a light scheme gets a light frame.
//
// Layering, lowest to highest (resolveTheme):
//   defaults + scheme overlay < site theme < owner `tokens` < owner
//   `tokensDark` (only while the scheme is dark).
// Only --pawbar-* keys survive, so an override map cannot reach anything but
// the widget's own tokens.
//
// No layer sets the credit colour: the credit wears the frame's own colours on
// a pill (see PawBarFrame), because the host page behind it is unknowable.

import { siteTokens, type SiteTheme } from './site-theme';

export type BarScheme = 'light' | 'dark';

/** The default's scheme overlays. Dark is the components' own fallbacks. */
export const DEFAULT_OVERLAY: Record<BarScheme, Record<string, string>> = {
  dark: {},
  light: {
    '--pawbar-frame-bg': 'rgb(250 250 252 / 0.82)',
    '--pawbar-frame-fg': '#1c1c21',
    '--pawbar-frame-border': 'rgb(0 0 0 / 0.12)',
    '--pawbar-bubble-bg': '#1c1c21',
    '--pawbar-bubble-fg': '#fafafa',
    // The pill rests with no frame around it, so on a pure white page this
    // border is its only edge: strong enough to read, still a hairline.
    '--pawbar-border': 'rgb(0 0 0 / 0.16)',
    '--pawbar-scrim': 'rgb(250 250 252 / 0.5)',
  },
};

/** The properties the layers resolve to. The owner's dark set is absent from
 *  the result on light, so a caller that removes whatever the result no longer
 *  carries drops the dark values with it. */
export function resolveTheme(
  overrides: Record<string, string> = {},
  scheme?: BarScheme,
  overridesDark: Record<string, string> = {},
  site: SiteTheme = {},
): Record<string, string> {
  const overlay = scheme ? DEFAULT_OVERLAY[scheme] : {};
  const owner = { ...overrides, ...(scheme === 'dark' ? overridesDark : {}) };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...overlay, ...siteTokens(site, scheme, owner), ...owner })) {
    if (k.startsWith('--pawbar-') && typeof v === 'string') out[k] = v;
  }
  return out;
}
