// tests/conversation-view-error.spec.svelte.ts — the old shell never prints a
// raw transport string to a visitor. Created 2026-09-27 (paw-bar states, section
// D live bug): chat-client handed onError strings like "paw-bar chat failed
// (429)" and the browser's own "Failed to fetch", the store copied them to
// store.error, and ConversationView rendered that verbatim under the thread.
// These tests mount the real view over a real ChatStore with a refusing fetch
// and assert the humane FAILURE_COPY line shows instead of developer text.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// CartBadge reads the cart from context, which only GlassShell provides. An
// empty cart renders nothing, which is all this view test needs from it.
vi.mock('../src/store/cart.svelte', async (orig) => ({
  ...(await orig<typeof import('../src/store/cart.svelte')>()),
  useCart: () => ({ cart: null, count: 0, popoverOpen: false, openCheckout: () => {} }),
}));

import ConversationView from '../src/components/ConversationView.svelte';
import { ChatStore } from '../src/store/chat.svelte';

const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };
const noop = () => {};
let live: ReturnType<typeof mount> | null = null;
let store: ChatStore | null = null;

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  store?.dispose?.();
  store = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function render(s: ChatStore): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  live = mount(ConversationView, {
    target,
    props: {
      store: s,
      agentName: 'Concierge',
      agentAvatar: '',
      subtitle: '',
      greeting: '',
      onback: noop,
      onclose: noop,
      onmenu: noop,
      onexpand: noop,
    },
  });
  return target;
}

describe('ConversationView failure line', () => {
  it('shows humane copy, not "paw-bar chat failed (429)", on a rate limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, body: null, json: async () => ({ detail: 'Rate limit exceeded' }), headers: new Headers() }),
    );
    store = new ChatStore(config);
    const view = render(store);
    await store.send('hi');
    flushSync();

    const text = view.textContent ?? '';
    expect(text).not.toContain('paw-bar chat failed');
    expect(text).not.toContain('429');
    expect(text).toContain("You're sending messages quickly.");
  });

  it('drops the cooldown line when the cooldown ends, leaving plain copy', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, body: null, json: async () => null, headers: new Headers() }),
    );
    store = new ChatStore(config);
    const view = render(store);
    await store.send('hi');
    vi.advanceTimersByTime(30_000);
    flushSync();
    vi.useRealTimers();

    const text = view.textContent ?? '';
    expect(text).not.toContain('{s}');
    expect(text).not.toContain('sending messages quickly');
    expect(text).toContain("Your message wasn't sent.");
  });

  it('shows humane copy, not "Failed to fetch", when the request never lands', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    store = new ChatStore(config);
    const view = render(store);
    await store.send('hi');
    flushSync();

    const text = view.textContent ?? '';
    expect(text).not.toContain('Failed to fetch');
    expect(text).toContain("Your message wasn't sent.");
  });
});
