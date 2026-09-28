// config.ts — Reads the window.__PAWBAR__ boot config the serving frame HTML
// injects before this bundle loads, with sane fallbacks for local `vite dev`.
// Created 2026-07-15 (A3): the frame endpoint (A1) sets window.__PAWBAR__ with
// { siteKey, widgetId, endpoint, parentOrigin, mode, tokens? }. In a
// plain `vite dev` page that global is absent, so we fall back to localhost
// dev defaults (a real reply still needs a running backend — that's the A4
// smoke, not this app's concern). parentOrigin defaults to document.referrer's
// origin (the embedding page) or '*' ONLY as a dev-page fallback — the real
// frame always supplies an exact origin, and postMessage refuses to post to a
// pinned origin mismatch in production.
// 2026-09-27 (old shell removed): `ui` is no longer read. There is one widget,
// so any value a backend sends (including 'glass') is ignored.
// 2026-09-27 (new bar): reads the new bar's owner settings. `barTheme`,
// `radius`, `launcher`, `side`, `barSize`, `logo`, `disclosure`,
// `privacyHref` and `consentRequired` style and gate it. The backend sends
// none of them yet, so each one has a default and an unknown value falls back
// to it; `logo` and `privacyHref` only accept http(s) or data URLs.
// 2026-07-16 (D4): added `greeting` — the owner's concierge greeting the frame
// emits from the Site doc. Read defensively (non-string coerces to ''); the
// shell shows it as the empty-state welcome, else the default copy.
// 2026-08-19 (host scheme): `scheme` is the owner's light/dark/auto choice, and
// it defaults to `auto` — meaning "follow the site". The widget cannot see the
// host page from inside a cross-origin frame, so the LOADER reads it and appends
// `?s=l|d` to the frame URL; readConfig picks that up here. See lib/scheme.ts
// for the precedence and loader/src/loader.ts for how the page is read.
//
// `tokens` is the owner's --pawbar-* map for light (or a pinned scheme);
// `tokensDark` is the map that goes over it whenever the bar resolves dark
// (PawBarFrame layers them via lib/bar-themes). Both must be a plain object;
// anything else reads as {}, and only string values are kept.
//
// 2026-08-19 (one theme): the old `theme` field is gone. The backend never emitted it, so the
// `?? 'dark'` fallback won on every site that has ever run this and the light
// palette was unreachable by construction. An owner who wants a different
// surface overrides --pawbar-* through `tokens`, which is the customization
// path that is actually wired and tested. A boot config still carrying `theme`
// is simply ignored rather than rejected — old frame HTML must keep booting.

import { hostSchemeFromUrl, readSetting, type SchemeSetting } from './lib/scheme';

export interface PawBarConfig {
  siteKey: string;
  widgetId: string;
  endpoint: string;
  parentOrigin: string;
  mode: 'concierge';
  /** TRUE only in the owner preview frame (D5), never a public embed. Gates the
   *  live-restyle listener: see main.ts. Absent/false on anything older. */
  preview: boolean;
  tokens: Record<string, string>;
  /** Applied over `tokens` while the resolved scheme is dark. {} when absent. */
  tokensDark: Record<string, string>;
  /** Owner's choice; 'auto' (the default) follows the host page. */
  scheme: SchemeSetting;
  /** What the loader read off the host page — 'l' | 'd', or '' standalone. */
  hostScheme: string;
  greeting: string;
  /** Conversation starters from the bound agent (capped 4 server-side). The
   *  frame has emitted these since E3; nothing read them until the Home tab
   *  had somewhere to put them. */
  starters: string[];
  /** Who the visitor is talking to. The backend emits "" for these until the
   *  appearance model ships, so every one has a working default — a widget on
   *  an older backend reads as a considered generic concierge rather than as a
   *  half-rendered one. */
  agentName: string;
  agentAvatar: string;
  agentSubtitle: string;
  /** Team faces for the Home tab's ask card. Empty renders an arrow instead. */
  avatars: string[];
  /** What the resting pill says. Owner-set ("Ask about Ocean Supply"); empty
   *  falls back to our generic copy in the shell rather than rendering blank. */
  launcherLabel: string;
  /** How wide the docked bar rests (2026-08-22).
   *
   *  'full'    — the bar always occupies its whole width, composer and all.
   *              What every bar has done since the hover morph was removed.
   *  'compact' — it rests as a narrow pill and widens to the full composer on
   *              hover or focus. The behaviour the morph used to provide, minus
   *              the clipping: the LOADER animates the frame and the app just
   *              fills it, so there is no longer an app-side width for the box
   *              to chase (see loader.ts BAR_W_REST).
   *
   *  Defaults to 'compact' — a resting widget on somebody else's site should
   *  ask for as little of their page as it can and grow when it is wanted. */
  barResting: 'full' | 'compact';
  barTheme: string;
  radius: number | undefined;
  launcher: 'bar' | 'icon';
  side: 'left' | 'right';
  barSize: 'sm' | 'md' | 'lg';
  logo: string;
  disclosure: string;
  privacyHref: string;
  consentRequired: boolean;
}

/** Read a string array off the boot config, dropping anything that isn't a
 *  non-empty string and capping the length. The frame is server-authored, but
 *  this file's whole job is to be the boundary that doesn't assume that. */
function readStrings(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

/** A --pawbar-* map off the boot config: a plain object with string values.
 *  An array, a string or null is not a map and reads as {}. */
function readTokens(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v;
  return out;
}

/** Only an http(s) or data URL may become an <img src>. A javascript: or
 *  vbscript: value in a boot config must never reach the DOM. */
function readImageUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  try {
    const proto = new URL(value, window.location.href).protocol;
    return proto === 'http:' || proto === 'https:' || proto === 'data:' ? value : '';
  } catch {
    return '';
  }
}

/** A link the visitor can follow: http(s) only. */
function readLinkUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  try {
    const proto = new URL(value, window.location.href).protocol;
    return proto === 'http:' || proto === 'https:' ? value : '';
  } catch {
    return '';
  }
}

function devParentOrigin(): string {
  // Best-effort: the referrer's origin is the embedding page in an iframe.
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch {
    /* malformed referrer — fall through */
  }
  // Standalone dev page (not embedded): no parent to talk to.
  return window.location.origin;
}

export function readConfig(): PawBarConfig {
  const boot = window.__PAWBAR__;
  return {
    siteKey: boot?.siteKey ?? 'dev-site-key',
    widgetId: boot?.widgetId ?? 'dev-widget',
    endpoint: boot?.endpoint ?? 'http://localhost:8888/api/v1',
    parentOrigin: boot?.parentOrigin ?? devParentOrigin(),
    mode: 'concierge',
    preview: boot?.preview === true,
    tokens: readTokens(boot?.tokens),
    tokensDark: readTokens(boot?.tokensDark),
    scheme: readSetting(boot?.scheme),
    hostScheme: hostSchemeFromUrl(window.location.search) ?? '',
    // Defensive: only a real string survives; a number/null/malformed value → ''.
    greeting: typeof boot?.greeting === 'string' ? boot.greeting : '',
    starters: readStrings(boot?.starters, 4),
    agentName: typeof boot?.agentName === 'string' && boot.agentName ? boot.agentName : 'Concierge',
    agentAvatar: readImageUrl(boot?.agentAvatar),
    agentSubtitle:
      typeof boot?.agentSubtitle === 'string' && boot.agentSubtitle
        ? boot.agentSubtitle
        : 'The team can also help',
    avatars: readStrings(boot?.avatars, 3).map(readImageUrl).filter(Boolean),
    // Capped to match the server's own bound (LauncherAppearance.label) so a
    // long value cannot stretch the resting pill across the host's page.
    launcherLabel:
      typeof boot?.launcherLabel === 'string' ? boot.launcherLabel.trim().slice(0, 40) : '',
    // Anything that is not the literal 'full' reads as 'compact', so a backend
    // that has never heard of this field gets the new resting behaviour rather
    // than a widget stuck in a mode nobody chose.
    barResting: boot?.barResting === 'full' ? 'full' : 'compact',
    barTheme: typeof boot?.barTheme === 'string' ? boot.barTheme : 'default',
    radius: typeof boot?.radius === 'number' && Number.isFinite(boot.radius) ? boot.radius : undefined,
    launcher: boot?.launcher === 'icon' ? 'icon' : 'bar',
    side: boot?.side === 'left' ? 'left' : 'right',
    barSize: boot?.barSize === 'sm' || boot?.barSize === 'lg' ? boot.barSize : 'md',
    logo: readImageUrl(boot?.logo) || readImageUrl(boot?.agentAvatar),
    disclosure: typeof boot?.disclosure === 'string' ? boot.disclosure.trim().slice(0, 140) : '',
    privacyHref: readLinkUrl(boot?.privacyHref),
    consentRequired: boot?.consentRequired === true,
  };
}
