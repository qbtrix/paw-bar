// config.ts — Reads the window.__PAWBAR__ boot config the serving frame HTML
// injects before this bundle loads, with sane fallbacks for local `vite dev`.
// Created 2026-07-15 (A3): the frame endpoint (A1) sets window.__PAWBAR__ with
// { siteKey, widgetId, endpoint, parentOrigin, mode, tokens?, theme? }. In a
// plain `vite dev` page that global is absent, so we fall back to localhost
// dev defaults (a real reply still needs a running backend — that's the A4
// smoke, not this app's concern). parentOrigin defaults to document.referrer's
// origin (the embedding page) or '*' ONLY as a dev-page fallback — the real
// frame always supplies an exact origin, and postMessage refuses to post to a
// pinned origin mismatch in production.

export interface PawBarConfig {
  siteKey: string;
  widgetId: string;
  endpoint: string;
  parentOrigin: string;
  mode: 'concierge';
  tokens: Record<string, string>;
  theme: 'light' | 'dark';
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
    theme: boot?.theme ?? 'dark',
  };
}
