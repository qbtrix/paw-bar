// config.ts — reads the window.__PAWBAR__ boot config the serving frame HTML
// injects before this bundle loads, with fallbacks for a plain `vite dev` page
// (localhost endpoint; parentOrigin from document.referrer, else this page's
// own origin — the real frame always supplies an exact origin).
//
// This file is the trust boundary for the boot config: every field is read
// defensively and has a default, so an older backend that sends none of the
// owner settings still boots a complete bar, and a malformed value falls back
// rather than reaching the DOM. `logo` and `privacyHref` accept only http(s)
// (and data: for images); `tokens` / `tokensDark` are plain string maps.
//
// Owner settings (readOwnerConfig, shared with the owner preview's live
// `pawbar:preview-config` channel in lib/preview-tokens): tokens, tokensDark,
// scheme, launcher, side, barSize, logo, launcherLabel, disclosure,
// privacyHref, consentRequired, voice (the dictation mic), poweredBy (the
// "Powered by Paw Sites" credit) and expandable (the full-screen toggle). The
// three booleans are on unless the owner sends exactly `false`.
//
// Two facts come from the LOADER rather than the boot config, because only it
// can see the host page: `hostScheme` (`?s=l|d` on the frame URL, see
// lib/scheme) and `siteTheme` (the `#t=` fragment, see lib/site-theme). The
// site theme sits under the owner's tokens; the bar has no theme presets.
//
// Retired keys are ignored, never rejected, so old frame HTML keeps booting:
// `theme` (2026-08-19), `ui` (2026-09-27), `barTheme` and `radius` (the bar
// follows the site; corners are `--pawbar-radius` in `tokens`).

import { hostSchemeFromUrl, readSetting, type SchemeSetting } from './lib/scheme';
import { siteThemeFromHash, type SiteTheme } from './lib/site-theme';

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
  /** The host page's look, read by the loader (`#t=`). {} standalone. */
  siteTheme: SiteTheme;
  launcher: 'bar' | 'icon';
  side: 'left' | 'right';
  barSize: 'sm' | 'md' | 'lg';
  logo: string;
  disclosure: string;
  privacyHref: string;
  consentRequired: boolean;
  /** The dictation mic in the open card. On unless the owner sends `false`
   *  (browsers transcribe on their vendor's servers). */
  voice: boolean;
  /** The "Powered by Paw Sites" credit. On unless the owner sends `false`. */
  poweredBy: boolean;
  /** The full-screen toggle. On unless the owner sends `false`. */
  expandable: boolean;
}

/** The owner settings, the part of the config the owner preview can change live. */
export type OwnerConfig = Pick<
  PawBarConfig,
  | 'tokens'
  | 'tokensDark'
  | 'scheme'
  | 'launcher'
  | 'side'
  | 'barSize'
  | 'logo'
  | 'launcherLabel'
  | 'disclosure'
  | 'privacyHref'
  | 'consentRequired'
  | 'voice'
  | 'poweredBy'
  | 'expandable'
>;

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

/** Normalise the owner settings off any boot-shaped object. */
export function readOwnerConfig(boot: Partial<PawBarBootConfig> | undefined): OwnerConfig {
  return {
    tokens: readTokens(boot?.tokens),
    tokensDark: readTokens(boot?.tokensDark),
    scheme: readSetting(boot?.scheme),
    launcher: boot?.launcher === 'icon' ? 'icon' : 'bar',
    side: boot?.side === 'left' ? 'left' : 'right',
    barSize: boot?.barSize === 'md' || boot?.barSize === 'lg' ? boot.barSize : 'sm',
    logo: readImageUrl(boot?.logo) || readImageUrl(boot?.agentAvatar),
    // Capped to match the server's own bound (LauncherAppearance.label) so a
    // long value cannot stretch the resting pill across the host's page.
    launcherLabel:
      typeof boot?.launcherLabel === 'string' ? boot.launcherLabel.trim().slice(0, 40) : '',
    disclosure: typeof boot?.disclosure === 'string' ? boot.disclosure.trim().slice(0, 140) : '',
    privacyHref: readLinkUrl(boot?.privacyHref),
    consentRequired: boot?.consentRequired === true,
    voice: boot?.voice !== false,
    poweredBy: boot?.poweredBy !== false,
    expandable: boot?.expandable !== false,
  };
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
    hostScheme: hostSchemeFromUrl(window.location.search) ?? '',
    siteTheme: siteThemeFromHash(window.location.hash),
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
    // Anything that is not the literal 'full' reads as 'compact', so a backend
    // that has never heard of this field gets the new resting behaviour rather
    // than a widget stuck in a mode nobody chose.
    barResting: boot?.barResting === 'full' ? 'full' : 'compact',
    ...readOwnerConfig(boot),
  };
}
