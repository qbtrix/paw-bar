// main.ts — Entry point for the Paw Bar iframe app.
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
// 2026-09-27 (new bar): mounts BarShell, the new Paw Bar, which builds the chat
// and operator stores itself once chatting is allowed (consent); owner-preview
// restyling targets its wrapper. The old GlassShell and its global CSS moved
// to mount-glass.ts and are chosen at BUILD time (`VITE_PAWBAR_UI=glass`), not
// per site: carrying both shells put the bundle 7KB over its budget, and the
// old shell's global CSS (box-sizing, a body font from its own tokens, the
// markdown rules) leaked onto the new bar. In `vite dev` the old dev pages
// still get it at runtime with `ui: 'glass'`. Cart, contact and conversations
// touch nothing until used.
// 2026-09-27 (old shell removed): mounts BarShell unconditionally. The
// __PAWBAR_GLASS__ build flag, the `ui: 'glass'` dev switch and mount-glass.ts
// are gone with the old GlassShell; a boot config that still sends `ui` is
// ignored (config.ts no longer reads it).
// 2026-09-26 (reply links): calls setLinkBase(config.parentOrigin) before
// mount, so site-relative links in agent replies (`/returns`) resolve to the
// host page instead of rendering as dead text (lib/markdown.ts validates it).
import { mount } from 'svelte';
import { readConfig } from './config';
import { ChatStore } from './store/chat.svelte';
import { ConversationsStore } from './store/conversations.svelte';
import { CartStore } from './store/cart.svelte';
import { ContactStore } from './store/contact.svelte';
import { OperatorStore } from './store/operator.svelte';
import { createPoster } from './lib/postmessage';
import { installPreviewTokenListener } from './lib/preview-tokens';
import { setLinkBase } from './lib/markdown';
import BarShell from './components/bar/BarShell.svelte';

const config = readConfig();

// Site-relative links in agent replies (`/returns`) resolve against the host
// page. setLinkBase validates it and ignores anything that is not an exact
// http(s) origin, in which case such links are dropped rather than guessed.
setLinkBase(config.parentOrigin);

const target = document.getElementById('pawbar-app') ?? document.body;

const storeConfig = {
  endpoint: config.endpoint,
  widgetId: config.widgetId,
  siteKey: config.siteKey,
};
const cart = new CartStore(storeConfig);
const contact = new ContactStore(storeConfig);
// The visitor's own conversation list (2026-08-19, Messenger).
const conversations = new ConversationsStore(storeConfig);
const poster = createPoster(config.parentOrigin);

mount(BarShell, {
  target,
  props: {
    config,
    poster,
    cart,
    contact,
    conversations,
    createChat: () => {
      const chat = new ChatStore(storeConfig);
      return { chat, operator: new OperatorStore(chat, storeConfig) };
    },
  },
});
installPreviewTokenListener({
  preview: config.preview,
  parentOrigin: config.parentOrigin,
  getRoot: () => target.querySelector<HTMLElement>('.frame-wrap'),
});
