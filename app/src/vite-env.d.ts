// vite-env.d.ts — ambient types for the glass concierge app.
// Created 2026-07-15 (A3): registers Vite client + Svelte types and declares
// the window.__PAWBAR__ config contract the serving frame HTML injects before
// the bundle loads (see src/config.ts for the reader + dev fallback).
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
  theme?: 'light' | 'dark';
}

interface Window {
  __PAWBAR__?: PawBarBootConfig;
}
