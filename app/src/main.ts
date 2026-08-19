// main.ts — Entry point for the glass concierge iframe app.
// Created 2026-07-15 (A3 glass bar): reads the window.__PAWBAR__ boot config
// (dev fallback in config.ts), injects any white-label token overrides as inline
// CSS vars on the mount root, builds the ChatStore + lifecycle poster, and mounts
// the GlassShell. Styles are imported here so Vite emits the single pawbar.css.
// 2026-07-15 (C2): also builds the CartStore for the visitor action loop and
// passes it to the shell, which provides it to descendant card CTAs via context.
// 2026-07-16 (D4): threads config.greeting to the shell as a prop so the panel's
// empty state renders the owner's concierge greeting when set.
// 2026-07-30 (email capture + articles): builds the ContactStore (pending-
// decision email prompt) and threads the store config to the shell so the
// articles view fetches against the same endpoint/widget/key.
// 2026-08-19 (Messenger): builds the ConversationsStore — the visitor's own
// conversation list, which the Messages tab reads. It could not exist before
// the backend gave conversations real identities; until then a visitor had
// exactly one per widget, forever, and there was nothing to list.
// 2026-07-30 (human takeover): builds the OperatorStore over the ChatStore —
// the poll that delivers the site owner's own replies into the thread. It is
// constructed AFTER the chat store so it seeds its `after` cursor from the
// restored transcript; the shell starts/stops the loop with the panel.
import { mount } from 'svelte';
import './styles/tokens.css';
import './styles/glass.css';
import GlassShell from './components/GlassShell.svelte';
import { readConfig } from './config';
import { ChatStore } from './store/chat.svelte';
import { ConversationsStore } from './store/conversations.svelte';
import { CartStore } from './store/cart.svelte';
import { ContactStore } from './store/contact.svelte';
import { OperatorStore } from './store/operator.svelte';
import { createPoster } from './lib/postmessage';

const config = readConfig();

const target = document.getElementById('pawbar-app') ?? document.body;

// White-label overrides: window.__PAWBAR__.tokens maps a --pawbar-* var to a
// value. Keys are normalized to the --pawbar- prefix; values go through the
// typed CSSOM API (setProperty), never string-concatenated into a style
// attribute.
//
// These MUST land on .pawbar-root ITSELF, not on the mount target above it.
// They used to be set on the parent and left to cascade down, which cannot
// work: tokens.css declares the whole --pawbar-* scale ON .pawbar-root, and a
// declaration on an element always beats a value inherited from its parent. So
// every owner override was silently discarded and the stylesheet defaults won.
// The customization path looked wired end to end and did nothing — and it went
// unnoticed because the backend answered `"tokens": {}` for exactly as long,
// so there was never a value there to lose. See tests/tokens.spec.ts.
function applyTokens(root: HTMLElement): void {
  for (const [rawKey, rawValue] of Object.entries(config.tokens)) {
    const key = rawKey.startsWith('--') ? rawKey : `--pawbar-${rawKey.replace(/^pawbar-/, '')}`;
    if (typeof rawValue === 'string') root.style.setProperty(key, rawValue);
  }
}

const storeConfig = {
  endpoint: config.endpoint,
  widgetId: config.widgetId,
  siteKey: config.siteKey,
};
const store = new ChatStore(storeConfig);
const cart = new CartStore(storeConfig);
const contact = new ContactStore(storeConfig);
const operator = new OperatorStore(store, storeConfig);
// The visitor's own conversation list (2026-08-19, Messenger). Built after the
// chat store so the panel can reconcile "which conversation am I in" against a
// thread that has already rehydrated from localStorage.
const conversations = new ConversationsStore(storeConfig);
const poster = createPoster(config.parentOrigin);

mount(GlassShell, {
  target,
  props: {
    store,
    cart,
    contact,
    operator,
    conversations,
    chatConfig: storeConfig,
    poster,
    scheme: config.scheme,
    hostScheme: config.hostScheme,
    greeting: config.greeting,
    starters: config.starters,
    agentName: config.agentName,
    agentAvatar: config.agentAvatar,
    agentSubtitle: config.agentSubtitle,
    avatars: config.avatars,
    launcherLabel: config.launcherLabel,
    // Lets the shell validate inbound loader messages (drag box, host intents)
    // against the same origin the poster pins outbound messages to.
    parentOrigin: config.parentOrigin,
  },
});

// The root exists only once Svelte has drawn it, so the owner's overrides are
// applied here rather than before mount. Synchronous — mount() has already
// rendered by the time it returns — so the first painted frame is the styled
// one and no visitor watches a default palette flip to the owner's.
const root = target.querySelector<HTMLElement>('.pawbar-root');
if (root) applyTokens(root);
