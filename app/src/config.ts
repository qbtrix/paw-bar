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
// 2026-07-16 (D4): added `greeting` — the owner's concierge greeting the frame
// emits from the Site doc. Read defensively (non-string coerces to ''); the
// shell shows it as the empty-state welcome, else the default copy.
// 2026-08-19 (host scheme): `scheme` is the owner's light/dark/auto choice, and
// it defaults to `auto` — meaning "follow the site". The widget cannot see the
// host page from inside a cross-origin frame, so the LOADER reads it and appends
// `?s=l|d` to the frame URL; readConfig picks that up here. See lib/scheme.ts
// for the precedence and loader/src/loader.ts for how the page is read.
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
  tokens: Record<string, string>;
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
    tokens: boot?.tokens ?? {},
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
  };
}
