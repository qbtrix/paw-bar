// main.ts — Entry point for the Paw Bar iframe app.
//
// Reads the window.__PAWBAR__ boot config (dev fallback in config.ts), builds
// the stores that touch nothing until used (cart, contact, the visitor's
// conversation list) and the lifecycle poster, and mounts BarShell, which
// builds the chat and operator stores itself once chatting is allowed. The
// operator store is built after the chat store so it seeds its cursor from
// the restored transcript. Styles imported here become the single pawbar.css.
//
// Before mount it pins site-relative reply links (`/returns`) to the host page
// via setLinkBase(config.parentOrigin), and warns once when there is no pinned
// parent origin, because every loader message is then ignored
// (lib/from-loader). The owner-preview token listener targets the wrapper.
// It also builds the page-actions runner over the poster and hands it to both
// the chat store (to run actions) and BarShell (to deliver the host's replies).
import { mount } from 'svelte';
import { readConfig } from './config';
import { ChatStore } from './store/chat.svelte';
import { ConversationsStore } from './store/conversations.svelte';
import { CartStore } from './store/cart.svelte';
import { ContactStore } from './store/contact.svelte';
import { OperatorStore } from './store/operator.svelte';
import { createPoster } from './lib/postmessage';
import { createActionRunner } from './lib/page-actions';
import { installPreviewTokenListener } from './lib/preview-tokens';
import { setLinkBase } from './lib/markdown';
import { isPinnedOrigin } from './lib/from-loader';
import BarShell from './components/bar/BarShell.svelte';

const config = readConfig();

// No pinned parent origin means the bar ignores every loader message (see
// lib/from-loader). Say so once, so a missing allowed origin is not silent.
if (window.parent !== window && !isPinnedOrigin(config.parentOrigin)) {
  console.warn('[paw-bar] no allowed parent origin; host messages are ignored');
}

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
// Page actions go to the host page's actions.js through the same pinned poster.
const actions = createActionRunner((message) => poster.act(message));

mount(BarShell, {
  target,
  props: {
    config,
    poster,
    cart,
    contact,
    conversations,
    actions,
    createChat: () => {
      const chat = new ChatStore({ ...storeConfig, runAction: actions.run });
      return { chat, operator: new OperatorStore(chat, storeConfig) };
    },
  },
});
installPreviewTokenListener({
  preview: config.preview,
  parentOrigin: config.parentOrigin,
  getRoot: () => target.querySelector<HTMLElement>('.frame-wrap'),
});
