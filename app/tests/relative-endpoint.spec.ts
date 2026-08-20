// tests/relative-endpoint.spec.ts — the endpoint is a PREFIX, not an absolute URL.
// Created 2026-08-21 from a live capture, after "i had a chat but i don't see my
// chat history" survived two fixes that were both real and both beside the point.
//
// The frame seeds its own config, and in production it seeds a RELATIVE endpoint:
//
//   window.__PAWBAR__ = { ..., "endpoint": "/api/v1", ... }
//
// Every client in this app treats that as a prefix and hands the result to
// fetch(), which resolves it against the frame's own origin. conversations-client
// is the one exception: it feeds it to `new URL()`, and `new URL('/api/v1/…')`
// with no base throws. Confirmed against the live bundle:
//
//   TypeError: Failed to construct 'URL': Invalid URL
//       at Yv (pawbar.js:78:3486)
//       at Jv.refresh (pawbar.js:78:10384)
//
// The throw happens BEFORE fetch, so the request never reaches the network — a
// live capture of a real visit shows articles, chat, cart and the operator poll
// all firing and not one call to /paw-bar/conversations, ever. The construction
// also sits OUTSIDE the try/catch that documents "every failure degrades SILENTLY
// to a safe value", and ConversationsStore.refresh() wraps its call in
// try/finally with no catch, so it escapes as an unhandled rejection.
//
// What that costs, all downstream of one line:
//   * the Messages tab is permanently empty — there IS no history to open
//   * conversations.activeId stays "", so adoptConversation never fires, so
//     `pawbar.active.v1.<widget>` is never written and the thread stays filed
//     under the ".active" sentinel
//   * fetchConversationMessages has the same construction, so the server-side
//     history recovery has never once run on a deployed bar
//   * openConversation (POST) uses plain fetch and works, which is why
//     conversations kept being CREATED while none were ever LISTED
//
// No test caught it because every test here passes an absolute endpoint
// ('http://t.local'). Production has never used one. So these tests use the
// relative form the frame actually seeds.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchConversations, fetchConversationMessages, openConversation } from '../src/lib/conversations-client';
import { ConversationsStore } from '../src/store/conversations.svelte';

// Exactly what the frame seeds — see the live __PAWBAR__ above.
const config = { endpoint: '/api/v1', widgetId: 'pp-1a00dff9fa0-kebe', signedKey: 'site_key_x' };
const storeConfig = { endpoint: '/api/v1', widgetId: 'pp-1a00dff9fa0-kebe', siteKey: 'site_key_x' };
const REF = 'dec1b6e46474d6a8';

function respond(body: unknown, ok = true) {
  // Typed args, not `async () =>`: without them the mock's call tuple is `[]`
  // and every `spy.mock.calls[0][0]` below is a type error.
  const spy = vi.fn(
    async (_url: string, _init?: RequestInit) => ({ ok, json: async () => body }) as unknown as Response,
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('a relative endpoint, which is what production actually seeds', () => {
  it('still asks the server for the conversation list', async () => {
    const spy = respond({
      conversations: [{ id: 'ppc-1', state: 'open', preview: 'Hey', last_message_at: '', active: true }],
    });

    const rows = await fetchConversations(config, REF);

    // The request has to REACH the network. Returning [] would be the documented
    // failure-soft behaviour; never calling fetch at all is the bug.
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toContain('/api/v1/paw-bar/conversations');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'ppc-1', active: true });
  });

  it('carries the query the endpoint is scoped by', async () => {
    const spy = respond({ conversations: [] });

    await fetchConversations(config, REF);

    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('w=pp-1a00dff9fa0-kebe');
    expect(url).toContain('key=site_key_x');
    expect(url).toContain(`customer_ref=${REF}`);
  });

  it('still fetches one conversation the visitor came back to', async () => {
    const spy = respond({ messages: [{ role: 'user', content: 'Hey', created_at: '' }] });

    const turns = await fetchConversationMessages(config, REF, 'ppc-1');

    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toContain('/api/v1/paw-bar/conversations/ppc-1/messages');
    expect(turns).toHaveLength(1);
  });

  it('keeps escaping a conversation id that arrives with a slash in it', async () => {
    const spy = respond({ messages: [] });

    await fetchConversationMessages(config, REF, 'a/../b');

    // The id lands in the PATH, so it must stay escaped whichever way the URL is
    // built — otherwise it walks the path.
    expect(String(spy.mock.calls[0][0])).toContain('a%2F..%2Fb');
  });

  it('the store refresh never throws, which is what it promises', async () => {
    respond({ conversations: [] });
    const store = new ConversationsStore(storeConfig);

    // "Every read degrades to the list it already has." An escaping throw takes
    // the caller's openPanel() down with it as an unhandled rejection.
    await expect(store.refresh()).resolves.toBeUndefined();
    expect(store.loading).toBe(false);
  });

  it('keeps the list it is showing when a later read blows up', async () => {
    // Load once for real, so the store is in the state a visitor actually sees.
    respond({
      conversations: [{ id: 'ppc-old', state: 'open', preview: 'kept', last_message_at: '', active: true }],
    });
    const store = new ConversationsStore(storeConfig);
    await store.refresh();
    expect(store.items).toHaveLength(1);

    // Now the read throws outright rather than returning a safe value.
    vi.stubGlobal('fetch', vi.fn((_url: string) => { throw new TypeError('Failed to construct URL'); }));

    await expect(store.refresh()).resolves.toBeUndefined();
    // Emptying the Messages tab in front of someone mid-conversation is worse
    // than showing them the list one refresh stale.
    expect(store.items).toHaveLength(1);
    expect(store.loading).toBe(false);
  });

  it('opening a new conversation still works (it always did — plain fetch)', async () => {
    const spy = respond({ id: 'ppc-2', state: 'open', preview: '', last_message_at: '', active: true });

    const opened = await openConversation(config, REF);

    expect(spy).toHaveBeenCalled();
    expect(opened).toMatchObject({ id: 'ppc-2' });
  });
});
