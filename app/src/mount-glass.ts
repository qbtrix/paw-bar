// mount-glass.ts — mounts the old GlassShell widget.
// Created 2026-09-27, moved out of main.ts when the new bar became the widget.
// Everything here (the shell, its components and its global CSS) is only in a
// bundle built with VITE_PAWBAR_UI=glass, or loaded in `vite dev` when a page
// sets ui: 'glass'. The mount itself is main.ts's old body, unchanged.
import { mount } from 'svelte';
import './styles/tokens.css';
import './styles/glass.css';
import GlassShell from './components/GlassShell.svelte';
import type { PawBarConfig } from './config';
import { ChatStore } from './store/chat.svelte';
import { OperatorStore } from './store/operator.svelte';
import type { CartStore } from './store/cart.svelte';
import type { ContactStore } from './store/contact.svelte';
import type { ConversationsStore } from './store/conversations.svelte';
import type { PawBarPoster } from './lib/postmessage';
import { applyTokens } from './lib/tokens';
import { installPreviewTokenListener } from './lib/preview-tokens';

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
export function mountGlass({
  target,
  config,
  storeConfig,
  cart,
  contact,
  conversations,
  poster,
}: {
  target: HTMLElement;
  config: PawBarConfig;
  storeConfig: { endpoint: string; widgetId: string; siteKey: string };
  cart: CartStore;
  contact: ContactStore;
  conversations: ConversationsStore;
  poster: PawBarPoster;
}): void {
  const store = new ChatStore(storeConfig);
  const operator = new OperatorStore(store, storeConfig);

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
      barResting: config.barResting,
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
  if (root) applyTokens(root, config.tokens);

  // Live restyling, owner preview ONLY. Both gates (preview flag + a known parent
  // origin) live in installPreviewTokenListener, which refuses to install rather
  // than installing something permissive — see lib/preview-tokens.ts.
  installPreviewTokenListener({
    preview: config.preview,
    parentOrigin: config.parentOrigin,
    getRoot: () => target.querySelector<HTMLElement>('.pawbar-root'),
  });
}
