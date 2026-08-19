// tests/conversations.spec.ts — the visitor's own conversation list.
// Created 2026-08-19 (Messenger). Covers the client (wire shape + the defensive
// coercion every public endpoint reader in this app owes) and the store (the
// latch, the refuses-to-empty-itself rule, and the active flag the composer
// depends on).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { fetchConversations, openConversation } from '../src/lib/conversations-client';
import { ConversationsStore } from '../src/store/conversations.svelte';

const config = { endpoint: 'http://t.local', widgetId: 'w1', signedKey: 'k1' };
const storeConfig = { endpoint: 'http://t.local', widgetId: 'w1', siteKey: 'k1' };

const row = (over: Record<string, unknown> = {}) => ({
  id: 'ppc_1',
  state: 'open',
  preview: 'hello',
  last_message_at: '2026-08-19T10:00:00Z',
  active: true,
  ...over,
});

function okJson(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body });
}

beforeEach(() => {
  const map = new Map<string, string>();
  const shim = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
  } as unknown as Storage;
  vi.stubGlobal('localStorage', shim);
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchConversations', () => {
  it('reads the wire rows and carries the query the gate needs', async () => {
    const mock = okJson({ conversations: [row(), row({ id: 'ppc_2', active: false })] });
    vi.stubGlobal('fetch', mock);

    const out = await fetchConversations(config, 'cust-1');

    expect(out.map((c) => c.id)).toEqual(['ppc_1', 'ppc_2']);
    expect(out[0].lastMessageAt).toBe('2026-08-19T10:00:00Z');
    const url = new URL(mock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/paw-bar/conversations');
    expect(url.searchParams.get('w')).toBe('w1');
    expect(url.searchParams.get('key')).toBe('k1');
    expect(url.searchParams.get('customer_ref')).toBe('cust-1');
  });

  it('drops rows it cannot trust instead of rendering them', async () => {
    vi.stubGlobal(
      'fetch',
      okJson({
        conversations: [
          row({ id: '' }), // no identity — unaddressable
          null,
          'nope',
          row({ id: 'ppc_ok', state: 42, preview: 99, active: 'yes' }),
        ],
      }),
    );

    const out = await fetchConversations(config, 'cust-1');

    expect(out).toHaveLength(1);
    // A non-boolean `active` must read false: two rows claiming to be in
    // progress would leave the composer unable to say which it writes into.
    expect(out[0]).toMatchObject({ id: 'ppc_ok', state: 'open', preview: '', active: false });
  });

  it('degrades to an empty list on a refusal, a network error, and bad JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    expect(await fetchConversations(config, 'cust-1')).toEqual([]);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchConversations(config, 'cust-1')).toEqual([]);

    vi.stubGlobal('fetch', okJson({ conversations: 'not an array' }));
    expect(await fetchConversations(config, 'cust-1')).toEqual([]);
  });
});

describe('openConversation', () => {
  it('POSTs the gate fields and returns the new row', async () => {
    const mock = okJson(row({ id: 'ppc_new' }));
    vi.stubGlobal('fetch', mock);

    const opened = await openConversation(config, 'cust-1');

    expect(opened?.id).toBe('ppc_new');
    const [url, opts] = mock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://t.local/paw-bar/conversations');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ key: 'k1', w: 'w1', customer_ref: 'cust-1' });
  });

  it('returns null on a refusal so the caller keeps the conversation it had', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    expect(await openConversation(config, 'cust-1')).toBeNull();
  });
});

describe('ConversationsStore', () => {
  it('loads the list and reports which conversation is in progress', async () => {
    vi.stubGlobal(
      'fetch',
      okJson({ conversations: [row({ id: 'ppc_new' }), row({ id: 'ppc_old', active: false })] }),
    );
    const store = new ConversationsStore(storeConfig);

    await store.refresh();

    expect(store.items).toHaveLength(2);
    expect(store.activeId).toBe('ppc_new');
    expect(store.loaded).toBe(true);
    expect(store.loading).toBe(false);
  });

  it('never empties a list the visitor is reading because a refresh failed', async () => {
    vi.stubGlobal('fetch', okJson({ conversations: [row()] }));
    const store = new ConversationsStore(storeConfig);
    await store.refresh();
    expect(store.items).toHaveLength(1);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await store.refresh();

    expect(store.items).toHaveLength(1);
  });

  it('latches overlapping refreshes so the newest answer is not overwritten', async () => {
    const mock = okJson({ conversations: [row()] });
    vi.stubGlobal('fetch', mock);
    const store = new ConversationsStore(storeConfig);

    // The panel opening, a tab mounting and a turn finishing all land at once.
    await Promise.all([store.refresh(), store.refresh(), store.refresh()]);

    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('puts a newly opened conversation at the head and demotes the rest', async () => {
    vi.stubGlobal('fetch', okJson({ conversations: [row({ id: 'ppc_old' })] }));
    const store = new ConversationsStore(storeConfig);
    await store.refresh();

    vi.stubGlobal('fetch', okJson(row({ id: 'ppc_new' })));
    const id = await store.open();

    expect(id).toBe('ppc_new');
    expect(store.items.map((c) => c.id)).toEqual(['ppc_new', 'ppc_old']);
    // Exactly one in progress, always.
    expect(store.items.filter((c) => c.active)).toHaveLength(1);
    expect(store.activeId).toBe('ppc_new');
  });

  it('syncActive ignores an id it has never heard of', async () => {
    vi.stubGlobal('fetch', okJson({ conversations: [row({ id: 'ppc_a' })] }));
    const store = new ConversationsStore(storeConfig);
    await store.refresh();

    store.syncActive('ppc_stranger');

    // Marking nothing active would leave the list claiming no conversation is
    // in progress while the composer is writing into one.
    expect(store.activeId).toBe('ppc_a');
  });
});
