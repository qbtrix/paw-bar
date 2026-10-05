// vite-env.d.ts — ambient types for the Paw Bar iframe app: Vite client and
// Svelte types, and the window.__PAWBAR__ boot config the serving frame HTML
// injects before the bundle loads. Every owner field is optional; src/config.ts
// reads each one defensively and defaults it. Retired keys a served frame may
// still send (`theme`, `ui`, `barTheme`, `radius`) are ignored at runtime;
// `theme` and `ui` stay declared so old fixtures type-check.
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
  /** TRUE only in the owner preview frame (D5). Gates the live-restyle listener
   *  in main.ts; absent on a public embed and on any frame served before
   *  2026-08-20, both of which must be treated as false. */
  preview?: boolean;
  /** Optional white-label overrides for the --pawbar-* token scale. */
  tokens?: Record<string, string>;
  /** Overrides applied over `tokens` while the bar resolves dark (auto on a
   *  dark host, or pinned dark). Absent on older backends. */
  tokensDark?: Record<string, string>;
  /** Optional 'light' | 'dark'; defaults to 'dark' (quiet-authority glass). */
  /** Owner's light/dark/auto choice. Absent → 'auto', i.e. follow the site. */
  scheme?: 'light' | 'dark' | 'auto';
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
  /** How the docked bar rests: 'full' (always its whole width) or 'compact'
   *  (a narrow pill that widens on hover/focus). Absent → 'compact'. */
  barResting?: 'full' | 'compact';
  /** IGNORED since 2026-09-27, when the old 'glass' shell was removed. Kept so
   *  a frame that still sends it type-checks; readConfig does not read it. */
  ui?: string;
  launcher?: 'bar' | 'icon';
  side?: 'left' | 'right';
  barSize?: 'sm' | 'md' | 'lg';
  /** The site's logo for the resting pill. Falls back to agentAvatar. */
  logo?: string;
  /** The owner's wording for the AI disclosure. Cannot remove it. */
  disclosure?: string;
  privacyHref?: string;
  /** The site's consent manager says chatting needs consent first. */
  consentRequired?: boolean;
  /** The dictation mic. Absent or anything but `false` → on. */
  voice?: boolean;
  /** The "Powered by Paw Sites" credit. Absent or anything but `false` → on. */
  poweredBy?: boolean;
  /** The full-screen toggle. Absent or anything but `false` → on. */
  expandable?: boolean;
}

interface Window {
  __PAWBAR__?: PawBarBootConfig;
}
