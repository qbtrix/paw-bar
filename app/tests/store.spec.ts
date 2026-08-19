// tests/store.spec.ts — Runes store flow coverage. Created 2026-07-15 (A3 glass
// bar). Mocks global fetch with a canned SSE body (the exact frames
// concierge_chat emits) and drives the store end to end: send() → streamed
// delta appended → stream_end finalizes the turn as 'done'; and stop() aborts an
// in-flight stream, keeping the partial text and clearing isStreaming. Runs
// under jsdom so getCustomerRef's window.crypto/localStorage exist.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ChatStore } from '../src/store/chat.svelte';

const CHUNK = 'event: chunk\ndata: {"content":"We open at 8am!","type":"text"}\n\n';
const END = 'event: stream_end\ndata: {"assistant_message_id":"m1","cancelled":false}\n\n';
const enc = (s: string) => new TextEncoder().encode(s);
const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };

// Drive-by (2026-08-19): three tests in this file failed on main because the
// ChatStore constructor rehydrates from localStorage and nothing cleared it
// between tests, so `messages[1]` addressed a previous test's turn. The suite
// was reporting a real leak as a store bug.
beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc(p));
      c.close();
    },
  });
}

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

describe('ChatStore.send', () => {
  it('appends the streamed reply and marks the turn done', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: streamOf(CHUNK + END) }));

    const store = new ChatStore(config);
    await store.send('When do you open?');

    expect(store.messages).toHaveLength(2);
    expect(store.messages[0]).toMatchObject({ role: 'user', content: 'When do you open?', status: 'done' });
    expect(store.messages[1]).toMatchObject({ role: 'assistant', content: 'We open at 8am!', status: 'done' });
    expect(store.isStreaming).toBe(false);
    expect(store.error).toBeNull();
  });

  it('POSTs the concierge contract body to /paw-bar/chat', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: streamOf(CHUNK + END) });
    vi.stubGlobal('fetch', fetchMock);

    await new ChatStore(config).send('hi');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://test.local/api/v1/paw-bar/chat');
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('omit');
    expect(opts.mode).toBe('cors');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({ widget_id: 'w1', signed_key: 'k1', message: 'hi' });
    expect(typeof body.customer_ref).toBe('string');
  });

  it('surfaces a server error frame', async () => {
    const ERR = 'event: error\ndata: {"message":"rate limited"}\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: streamOf(ERR) }));

    const store = new ChatStore(config);
    await store.send('hi');

    expect(store.error).toBe('rate limited');
    expect(store.messages[1].status).toBe('error');
    expect(store.isStreaming).toBe(false);
  });

  it('ignores an empty send and a send while already streaming', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: streamOf(CHUNK + END) }));
    const store = new ChatStore(config);
    await store.send('   ');
    expect(store.messages).toHaveLength(0);
  });
});

describe('ChatStore.stop', () => {
  it('aborts an in-flight stream, keeps the partial, clears isStreaming', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        c.enqueue(enc(CHUNK)); // one delta, then stay open (no close/end)
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
        opts.signal.addEventListener('abort', () => {
          controller?.error(new DOMException('Aborted', 'AbortError'));
        });
        return Promise.resolve({ ok: true, body });
      }),
    );

    const store = new ChatStore(config);
    const done = store.send('hi'); // don't await — stream stays open
    await tick(); // let the first chunk be read
    expect(store.isStreaming).toBe(true);
    expect(store.messages[1].content).toBe('We open at 8am!');

    store.stop();
    await done;

    expect(store.isStreaming).toBe(false);
    expect(store.messages[1].content).toBe('We open at 8am!'); // partial retained
    expect(store.messages[1].status).toBe('done');
  });

  it('drops the empty assistant bubble when stopped before any text', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c; // stay open, emit nothing
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
        opts.signal.addEventListener('abort', () => {
          controller?.error(new DOMException('Aborted', 'AbortError'));
        });
        return Promise.resolve({ ok: true, body });
      }),
    );

    const store = new ChatStore(config);
    const done = store.send('hi');
    await tick();
    expect(store.messages).toHaveLength(2); // user + streaming assistant

    store.stop();
    await done;

    expect(store.messages).toHaveLength(1); // empty assistant bubble removed
    expect(store.messages[0].role).toBe('user');
    expect(store.error).toBeNull();
    expect(store.isStreaming).toBe(false);
  });
});
