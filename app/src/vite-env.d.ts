// vite-env.d.ts — ambient types for the glass concierge app.
// Created 2026-07-15 (A3): registers Vite client + Svelte types and declares
// the window.__PAWBAR__ config contract the serving frame HTML injects before
// the bundle loads (see src/config.ts for the reader + dev fallback).
// 2026-07-16 (D4): added the optional `greeting` field — the owner's concierge
// greeting the frame emits from the Site doc; the bar renders it as the
// empty-state welcome (blank/absent falls back to the default copy).
/// <reference types="svelte" />
/// <reference types="vite/client" />

interface PawBarBootConfig {
  siteKey: string;
  widgetId: string;
  /** REST base, e.g. "http://localhost:8888/api/v1". Chat POSTs to `${endpoint}/paw-bar/chat`. */
  endpoint: string;
  /** Exact origin of the host page; postMessage targetOrigin is pinned to this, never "*". */
  parentOrigin: string;
  mode: 'concierge';
  /** Optional white-label overrides for the --pawbar-* token scale. */
  tokens?: Record<string, string>;
  /** Optional 'light' | 'dark'; defaults to 'dark' (quiet-authority glass). */
  /** IGNORED since 2026-08-19 (one theme). Kept on the declared shape so old
   *  frame HTML that still emits it type-checks rather than being an unknown
   *  key — readConfig simply does not read it. Delete once no served frame
   *  sends it. */
  theme?: 'light' | 'dark';
  /** Optional owner-authored concierge greeting; shown as the empty-state welcome. */
  greeting?: string;
  /** 2026-08-19 (Messenger). Every field below is optional and defaulted in
   *  config.ts: a widget served by a backend that predates them renders a
   *  complete generic concierge rather than a half-filled one. */
  starters?: string[];
  agentName?: string;
  agentAvatar?: string;
  agentSubtitle?: string;
  avatars?: string[];
  /** The resting pill's copy, e.g. "Ask about Ocean Supply". */
  launcherLabel?: string;
}

interface Window {
  __PAWBAR__?: PawBarBootConfig;
}
