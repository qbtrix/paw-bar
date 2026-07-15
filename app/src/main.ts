// main.ts — Entry point for the glass concierge iframe app.
// Created 2026-07-15 (A3 glass bar): reads the window.__PAWBAR__ boot config
// (dev fallback in config.ts), injects any white-label token overrides as inline
// CSS vars on the mount root, builds the ChatStore + lifecycle poster, and mounts
// the GlassShell. Styles are imported here so Vite emits the single pawbar.css.
// 2026-07-15 (C2): also builds the CartStore for the visitor action loop and
// passes it to the shell, which provides it to descendant card CTAs via context.
import { mount } from 'svelte';
import './styles/tokens.css';
import './styles/glass.css';
import GlassShell from './components/GlassShell.svelte';
import { readConfig } from './config';
import { ChatStore } from './store/chat.svelte';
import { CartStore } from './store/cart.svelte';
import { createPoster } from './lib/postmessage';

const config = readConfig();

const target = document.getElementById('pawbar-app') ?? document.body;

// White-label overrides: window.__PAWBAR__.tokens maps a --pawbar-* var to a
// value. We set them on the mount target so they cascade to .pawbar-root. Keys
// are normalized to the --pawbar- prefix; values are set via the typed CSSOM
// API (setProperty), never string-concatenated into a style attribute.
for (const [rawKey, rawValue] of Object.entries(config.tokens)) {
  const key = rawKey.startsWith('--') ? rawKey : `--pawbar-${rawKey.replace(/^pawbar-/, '')}`;
  if (typeof rawValue === 'string') target.style.setProperty(key, rawValue);
}

const storeConfig = {
  endpoint: config.endpoint,
  widgetId: config.widgetId,
  siteKey: config.siteKey,
};
const store = new ChatStore(storeConfig);
const cart = new CartStore(storeConfig);
const poster = createPoster(config.parentOrigin);

mount(GlassShell, {
  target,
  props: {
    store,
    cart,
    poster,
    theme: config.theme,
    // Lets the shell validate inbound loader messages (drag box, host intents)
    // against the same origin the poster pins outbound messages to.
    parentOrigin: config.parentOrigin,
  },
});
