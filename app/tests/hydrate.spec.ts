// tests/hydrate.spec.ts — the visitor's thread comes back from the SERVER.
//
// Created 2026-08-21.
//
// THE BUG. localStorage was the record, not a cache. This bar is a THIRD-PARTY
// iframe: Safari blocks its storage outright, Chrome and Firefox partition it
// per top-level site, and the stored row carries a 7-day TTL besides. Any of
// those losing the transcript lost the conversation permanently — while the
// server held every message the whole time (it is what the owner's inbox reads)
// and the widget had no call that could ask for them.
//
// The reported shape was exactly this: a visitor chats, navigates, comes back to
// an empty panel, and `pawbar.active.v1.<widget>` is still in localStorage
// pointing at a conversation whose turns nothing can load. The pointer has no
// TTL; the thread does.
//
// What these pin is the two-step — cache paints first, server replaces — and,
// more importantly, the cases where the server's answer must NOT be adopted.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatStore } from '../src/store/chat.svelte';
import { saveActiveConversationId, saveTranscript } from '../src/lib/transcript';

const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };
const CONV = 'ppc-1';

function serverTurns(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
  );
}

/** Let the constructor's fire-and-forget hydrate settle. */
const settle = () => vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());

beforeEach(() => {
  localStorage.clear();
  saveActiveConversationId(config.widgetId, CONV);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('hydrating a conversation from the server', () => {
  it('replaces the cached thread with the server copy', async () => {
    saveTranscript(config.widgetId, [
      { id: 'a', role: 'user', content: 'stale question', status: 'done' },
    ], CONV);
    serverTurns({
      messages: [
        { role: 'user', content: 'Do you deliver on Sundays?', created_at: '2026-08-21T10:00:00Z' },
        { role: 'assistant', content: 'We do, until 4pm.', created_at: '2026-08-21T10:00:01Z' },
      ],
    });

    const store = new ChatStore(config);
    await settle();

    await vi.waitFor(() => expect(store.messages).toHaveLength(2));
    expect(store.messages.map((m) => m.content)).toEqual([
      'Do you deliver on Sundays?',
      'We do, until 4pm.',
    ]);
  });

  it('recovers a thread that localStorage lost entirely', async () => {
    // The whole point: nothing cached, pointer intact — the Safari / partitioned
    // / TTL-expired case, which used to render an empty panel forever.
    serverTurns({ messages: [{ role: 'user', content: 'Still here', created_at: '' }] });

    const store = new ChatStore(config);
    await settle();

    await vi.waitFor(() => expect(store.messages).toHaveLength(1));
    expect(store.messages[0].content).toBe('Still here');
  });

  it('keeps the cache when the server cannot be asked', async () => {
    saveTranscript(config.widgetId, [
      { id: 'a', role: 'user', content: 'offline but mine', status: 'done' },
    ], CONV);
    serverTurns(null, false); // 404 / offline → fetchConversationMessages returns null

    const store = new ChatStore(config);
    await settle();

    // Blanking a thread we still have because the network hiccuped would be a
    // worse bug than the one this feature fixes.
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].content).toBe('offline but mine');
  });

  it('adopts a genuinely empty thread', async () => {
    saveTranscript(config.widgetId, [
      { id: 'a', role: 'user', content: 'cleared server-side', status: 'done' },
    ], CONV);
    serverTurns({ messages: [] });

    const store = new ChatStore(config);
    await settle();

    // [] is the server SAYING empty, which is different from null meaning "could
    // not ask". A conversation cleared server-side must not be resurrected from a
    // stale cache forever.
    await vi.waitFor(() => expect(store.messages).toHaveLength(0));
  });

  it('does not ask at all without a conversation pointer', async () => {
    localStorage.clear();
    serverTurns({ messages: [{ role: 'user', content: 'nope', created_at: '' }] });

    const store = new ChatStore(config);
    await new Promise((r) => setTimeout(r, 10));

    // A visitor who has never spoken has nothing to hydrate; asking would be a
    // round-trip per bar load on every page of every site.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(store.messages).toHaveLength(0);
  });

  it('folds owner and system lines onto the assistant side', async () => {
    serverTurns({
      messages: [
        { role: 'owner', content: 'Maya here — let me check.', created_at: '' },
        { role: 'system', content: 'Handed to the team.', created_at: '' },
      ],
    });

    const store = new ChatStore(config);
    await settle();

    // The server widened roles past user|assistant. Dropping what it does not
    // recognise would silently omit the human's replies, which is worse than
    // having no history.
    await vi.waitFor(() => expect(store.messages).toHaveLength(2));
    expect(store.messages.every((m) => m.role === 'assistant')).toBe(true);
  });
});
