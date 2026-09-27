// components/spec/style.ts — styling that arrives inside a Ripple spec.
// Created 2026-09-27 with the spec renderer.
//
// A spec can carry styling in two places: `theme` on the spec (colours, radius,
// fonts, mode) and `style` / `class` on any node. The theme becomes CSS custom
// properties with the same names Ripple's own themeToCssVars emits, so a
// component written against Ripple's tokens reads them unchanged. That helper
// lives in the root of @ripple-ui/core, whose schema module runs zod at import
// time, so it is re-implemented here rather than imported.
//
// Spec styling is written by an agent and shown on a customer's site, so every
// declaration is filtered. A value that could fetch something (`url(`,
// `image-set(`, `@import`) or break out of its declaration (`;`, braces, angle
// brackets, backslashes) is dropped, along with over-long values and property
// names that aren't plain CSS identifiers. The host's own styling is trusted
// and does not come through here.

/** The theme shape a spec may carry (Ripple's ThemeOverrides). */
export interface SpecTheme {
  colors?: Record<string, string | undefined>;
  radius?: string;
  mode?: 'light' | 'dark' | 'system';
  fonts?: { sans?: string; serif?: string; mono?: string; heading?: string };
}

const MAX_VALUE = 200;
const NAME_RE = /^-{0,2}[a-zA-Z][a-zA-Z0-9-]*$/;
const UNSAFE_VALUE_RE = /url\s*\(|image-set\s*\(|expression\s*\(|@import|javascript:|[;{}<>\\]/i;
const UNSAFE_NAMES = new Set(['behavior', '-moz-binding']);

/** A declaration value is kept only when it can't load anything or escape. */
export function isSafeValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_VALUE && !UNSAFE_VALUE_RE.test(value);
}

function kebab(name: string): string {
  return name.startsWith('--') ? name : name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * A spec node's `style` record as an inline style string, minus anything
 * unsafe. camelCase names become kebab-case; custom properties pass as-is.
 * Returns undefined when nothing survives, so no empty `style=""` is written.
 */
export function specStyle(style: unknown): string | undefined {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return undefined;
  const decls: string[] = [];
  for (const [rawName, value] of Object.entries(style as Record<string, unknown>)) {
    if (!NAME_RE.test(rawName)) continue;
    const name = kebab(rawName);
    if (UNSAFE_NAMES.has(name.toLowerCase())) continue;
    if (!isSafeValue(value)) continue;
    decls.push(`${name}: ${value.trim()}`);
  }
  return decls.length > 0 ? decls.join('; ') : undefined;
}

/** The spec theme as CSS custom properties, named as Ripple names them. */
export function themeVars(theme: SpecTheme | undefined): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!theme || typeof theme !== 'object') return vars;
  for (const [token, value] of Object.entries(theme.colors ?? {})) {
    if (/^[a-z0-9-]+$/.test(token) && isSafeValue(value)) vars[`--${token}`] = value.trim();
  }
  if (isSafeValue(theme.radius)) vars['--radius'] = theme.radius.trim();
  for (const key of ['sans', 'serif', 'mono', 'heading'] as const) {
    const value = theme.fonts?.[key];
    if (isSafeValue(value)) vars[`--ripple-font-${key}`] = value.trim();
  }
  return vars;
}

/** themeVars serialized for an inline style attribute. */
export function themeStyle(theme: SpecTheme | undefined): string {
  return Object.entries(themeVars(theme))
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}
