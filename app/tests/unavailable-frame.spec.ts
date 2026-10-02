// tests/unavailable-frame.spec.ts — the server's `unavailable` SSE frame.
// When a Concierge turn can't be answered (a provider error after a retry:
// reason "temporary"; the site's spend cap or quota: reason "limit") the server
// sends `event: unavailable` then `stream_end`, sometimes after some text. The
// bar turns that into a failed assistant turn carrying the reason, never the
// "No answer came back" empty failure, and never calls request-human itself.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createSseParser } from '../src/lib/sse';
import { dispatchFrame, type ChatCallbacks } from '../src/lib/chat-client';
import { ChatStore } from '../src/store/chat.svelte';

const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };
const enc = (s: string) => new TextEncoder().encode(s);
const CHUNK = (t: string) => `event: chunk\ndata: {"content":"${t}","type":"text"}\n\n`;
const UNAVAILABLE = (reason: string) => `event: unavailable\ndata: {"type":"unavailable","reason":"${reason}"}\n\n`;
const END = 'event: stream_end\ndata: {}\n\n';

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc(p));
      c.close();
    },
  });
}
const ok = (...parts: string[]) => ({ ok: true, status: 200, body: streamOf(...parts) });

function callbacks(): ChatCallbacks & { [k: string]: ReturnType<typeof vi.fn> } {
  return { onChunk: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
}

const stores: ChatStore[] = [];
function makeStore(): ChatStore {
  const s = new ChatStore(config);
  stores.push(s);
  return s;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parsing the unavailable frame', () => {
  it('the SSE parser hands it through as its own event', () => {
    const frames = createSseParser().push(UNAVAILABLE('limit') + END);
    expect(frames.map((f) => f.event)).toEqual(['unavailable', 'stream_end']);
    expect(JSON.parse(frames[0].data)).toEqual({ type: 'unavailable', reason: 'limit' });
  });

  it.each([
    ['temporary', 'temporary'],
    ['limit', 'limit'],
    ['something_new', 'temporary'],
  ])('reason %s is reported as %s and ends the turn', (sent, expected) => {
    const cb = callbacks();
    const [frame] = createSseParser().push(UNAVAILABLE(sent));
    expect(dispatchFrame(frame, cb)).toBe(false);
    expect(cb.onError).toHaveBeenCalledWith({ source: 'frame', event: 'unavailable', reason: expected });
    expect(cb.onEnd).not.toHaveBeenCalled();
  });

  it('a frame with no readable reason is temporary', () => {
    const cb = callbacks();
    dispatchFrame({ event: 'unavailable', data: 'not json' }, cb);
    expect(cb.onError).toHaveBeenCalledWith({ source: 'frame', event: 'unavailable', reason: 'temporary' });
  });
});

describe('the turn an unavailable frame leaves behind', () => {
  const chatCalls = (m: ReturnType<typeof vi.fn>) => m.mock.calls.filter(([url]) => String(url).endsWith('/paw-bar/chat'));
  const humanCalls = (m: ReturnType<typeof vi.fn>) =>
    m.mock.calls.filter(([url]) => String(url).includes('request-human'));

  it('temporary: the reply is marked unavailable for that turn only, and nobody is contacted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(UNAVAILABLE('temporary'), END));
    vi.stubGlobal('fetch', fetchMock);
    const store = makeStore();

    expect(await store.send('hi')).toEqual({ ok: false, kind: 'unavailable' });
    expect(store.messages).toHaveLength(2);
    expect(store.messages[0]).toMatchObject({ role: 'user', status: 'done' });
    expect(store.messages[1]).toMatchObject({ role: 'assistant', status: 'error', failure: 'unavailable', unavailable: 'temporary' });
    // Not the clean-but-empty failure.
    expect(store.messages[1].failure).not.toBe('empty');
    // The bar stays open: no bar-level lock, no near-input line, Send works.
    expect(store.unavailable).toBeNull();
    expect(store.notice).toBeNull();
    expect(store.isStreaming).toBe(false);
    expect(humanCalls(fetchMock)).toHaveLength(0);
  });

  it('temporary after some text keeps the text and still marks the turn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(CHUNK('Let me'), UNAVAILABLE('temporary'), END)));
    const store = makeStore();
    await store.send('hi');
    expect(store.messages[1]).toMatchObject({ content: 'Let me', status: 'error', failure: 'unavailable', unavailable: 'temporary' });
  });

  it('Try again resends the same visitor message and replaces the failed reply', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(UNAVAILABLE('temporary'), END))
      .mockResolvedValueOnce(ok(CHUNK('Hello'), END));
    vi.stubGlobal('fetch', fetchMock);
    const store = makeStore();
    await store.send('what are your hours?');

    expect(await store.retry(store.messages[1].id)).toEqual({ ok: true });
    const calls = chatCalls(fetchMock);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1][1].body).message).toBe('what are your hours?');
    expect(store.messages).toHaveLength(2);
    expect(store.messages[0]).toMatchObject({ role: 'user', content: 'what are your hours?' });
    expect(store.messages[1]).toMatchObject({ role: 'assistant', content: 'Hello', status: 'done' });
    expect(store.messages[1].unavailable).toBeUndefined();
    expect(humanCalls(fetchMock)).toHaveLength(0);
  });

  it('limit: the bar is down, the line offers email, and nobody is contacted until the visitor asks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(UNAVAILABLE('limit'), END));
    vi.stubGlobal('fetch', fetchMock);
    const store = makeStore();

    expect(await store.send('hi')).toEqual({ ok: false, kind: 'unavailable' });
    expect(store.messages[1]).toMatchObject({ role: 'assistant', status: 'error', failure: 'unavailable', unavailable: 'limit' });
    expect(store.unavailable).toMatchObject({ kind: 'unavailable', contactable: true, reason: 'limit' });
    expect(store.notice).toEqual({
      kind: 'unavailable',
      text: "I'm not available right now. Leave your email and the team will get back to you.",
      action: 'contact',
    });
    expect(await store.send('more')).toEqual({ ok: false, kind: 'unavailable', restoreDraft: 'more' });
    expect(humanCalls(fetchMock)).toHaveLength(0);
  });
});
