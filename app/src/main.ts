// main.ts — entry point for the Paw Bar iframe app.
//
// Reads the boot config (config.ts; dev fallbacks there) into reactive state
// (lib/live-config), points reply links at the host page (setLinkBase, so a
// site-relative `/returns` resolves instead of rendering dead), builds the
// stores that touch nothing until used (cart, contact, conversations), the
// pinned poster to the loader and the page-actions runner over it, and mounts
// BarShell, which builds the chat and operator stores itself once chatting is
// allowed (consent).
//
// The owner preview (config.preview) also gets its two live channels from
// lib/preview-tokens: pawbar:preview-config writes owner settings into the
// live config, and pawbar:preview-tokens paints tokens on the bar's
// .frame-wrap. Both refuse to install without preview and an exact
// parentOrigin.
//
// It warns once at boot when there is no pinned parent origin, because every
// loader message is then ignored (lib/from-loader).
import { mount } from 'svelte';
import { readConfig } from './config';
import { liveConfig } from './lib/live-config.svelte';
import { ChatStore } from './store/chat.svelte';
import { ConversationsStore } from './store/conversations.svelte';
import { CartStore } from './store/cart.svelte';
import { ContactStore } from './store/contact.svelte';
import { OperatorStore } from './store/operator.svelte';
import { createPoster } from './lib/postmessage';
import { createActionRunner } from './lib/page-actions';
import { installPreviewConfigListener, installPreviewTokenListener } from './lib/preview-tokens';
import { setLinkBase } from './lib/markdown';
import { isPinnedOrigin } from './lib/from-loader';
import BarShell from './components/bar/BarShell.svelte';

const config = liveConfig(readConfig());

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
installPreviewConfigListener({
  preview: config.preview,
  parentOrigin: config.parentOrigin,
  apply: (patch) => Object.assign(config, patch),
});
installPreviewTokenListener({
  preview: config.preview,
  parentOrigin: config.parentOrigin,
  getRoot: () => target.querySelector<HTMLElement>('.frame-wrap'),
});
