// tests/operator.spec.ts — A human joining the conversation. Created
// 2026-07-30 (type-to-takeover, slice 2). Four contracts pinned here, all
// headless against a mocked fetch:
//   1. lib/operator-poll validation — the good payload parses, malformed rows
//      are dropped without taking the good ones down, and every failure shape
//      (404, refusal, network error, junk body) returns null so the widget
//      behaves EXACTLY as it did before the endpoint existed.
//   2. Append idempotency — repeat polls and a page reload (transcript
//      restore) never duplicate an owner message; the "team joined" chip
//      appears exactly once, ever.
//   3. Persistence — owner + system turns round-trip through lib/transcript
//      with their `at` cursor, and no status rehydrates as 'streaming'.
//   4. The human_replying frame — finalizes the turn WITHOUT the
//      clean-but-empty 'No reply.' error, renders the line as a system chip,
//      and flips botPaused.
//   5. Poll lifecycle — immediate poll on start, no double-scheduling, no
//      stacking behind a slow backend, paused while the tab is hidden, silent
//      after stop().
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import {
  fetchOperatorMessages,
  laterAt,
  operatorMessageId,
  OPERATOR_CONTENT_MAX,
  type OperatorMessage,
} from '../src/lib/operator-poll';
import { loadTranscript, saveTranscript, serializeTranscript } from '../src/lib/transcript';
import { ChatStore, JOIN_NOTICE, JOIN_NOTICE_ID } from '../src/store/chat.svelte';
import { OperatorStore, OPERATOR_POLL_MS } from '../src/store/operator.svelte';

const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };
const clientConfig = { ...config, signedKey: 'k1', customerRef: 'cust-abc' };

const owner = (over: Partial<OperatorMessage> = {}): OperatorMessage => ({
  role: over.role ?? 'owner',
  content: over.content ?? 'Hi, this is Ada from the shop.',
  at: over.at ?? '2026-07-30T10:00:00Z',
});

// This repo's vitest/jsdom ships a method-less localStorage — shim a
// Map-backed Storage (the workspace's standard fix) instead of chasing it.
beforeEach(() => {
  const map = new Map<string, string>();
  const shim = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  vi.stubGlobal('localStorage', shim);
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setHidden(false);
});

function jsonRes(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
  };
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ── 1. Poll client validation ───────────────────────────────────────────────
describe('fetchOperatorMessages', () => {
  it('parses a good payload and calls the exact contract url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonRes({
        messages: [
          { role: 'owner', content: 'Hi there', at: '2026-07-30T10:00:00Z' },
          { role: 'system', content: 'Conversation reopened', at: '2026-07-30T10:01:00Z' },
        ],
        bot_paused: true,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchOperatorMessages(clientConfig, '2026-07-30T09:00:00Z');

    expect(result).not.toBeNull();
    expect(result!.botPaused).toBe(true);
    expect(result!.messages).toEqual([
      { role: 'owner', content: 'Hi there', at: '2026-07-30T10:00:00Z' },
      { role: 'system', content: 'Conversation reopened', at: '2026-07-30T10:01:00Z' },
    ]);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/paw-bar/messages/w1/cust-abc?');
    expect(url).toContain('signed_key=k1');
    expect(url).toContain('after=2026-07-30T09%3A00%3A00Z');
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.method).toBe('GET');
    expect(opts.credentials).toBe('omit');
    expect(opts.mode).toBe('cors');
  });

  it('omits `after` on the first poll', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ messages: [], bot_paused: false }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchOperatorMessages(clientConfig);

    expect(String(fetchMock.mock.calls[0][0])).not.toContain('after=');
  });

  it('drops malformed rows and keeps the good ones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonRes({
          messages: [
            { role: 'assistant', content: 'not an operator role', at: '2026-07-30T10:00:00Z' },
            { role: 'owner', content: '', at: '2026-07-30T10:00:00Z' },
            { role: 'owner', content: 'no timestamp', at: '' },
            { role: 'owner', content: 42, at: '2026-07-30T10:00:00Z' },
            null,
            'a bare string',
            { role: 'owner', content: '  keeps this one  ', at: '2026-07-30T10:02:00Z' },
          ],
          bot_paused: 'yes-ish',
        }),
      ),
    );

    const result = await fetchOperatorMessages(clientConfig);

    expect(result!.messages).toEqual([
      { role: 'owner', content: 'keeps this one', at: '2026-07-30T10:02:00Z' },
    ]);
    // bot_paused is honoured only as a real boolean.
    expect(result!.botPaused).toBe(false);
  });

  it('caps a huge content string', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonRes({ messages: [{ role: 'owner', content: 'x'.repeat(50_000), at: '2026-07-30T10:00:00Z' }] }),
        ),
    );

    const result = await fetchOperatorMessages(clientConfig);

    expect(result!.messages[0].content).toHaveLength(OPERATOR_CONTENT_MAX);
  });

  it('returns null for every failure shape, including a 404 backend', async () => {
    for (const mock of [
      vi.fn().mockResolvedValue(jsonRes({ detail: 'unknown widget' }, 404)),
      vi.fn().mockResolvedValue(jsonRes({}, 429)),
      vi.fn().mockResolvedValue(jsonRes({}, 401)),
      vi.fn().mockResolvedValue(jsonRes({}, 403)),
      vi.fn().mockRejectedValue(new TypeError('network down')),
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('nope')) }),
      vi.fn().mockResolvedValue(jsonRes({ messages: 'not an array' })),
      vi.fn().mockResolvedValue(jsonRes(null)),
    ]) {
      vi.stubGlobal('fetch', mock);
      expect(await fetchOperatorMessages(clientConfig)).toBeNull();
    }
  });
});

describe('operator-poll helpers', () => {
  it('derives a stable id from role + at + content', () => {
    expect(operatorMessageId(owner())).toBe(operatorMessageId(owner()));
    expect(operatorMessageId(owner())).not.toBe(operatorMessageId(owner({ content: 'different' })));
    expect(operatorMessageId(owner())).not.toBe(operatorMessageId(owner({ at: '2026-07-30T11:00:00Z' })));
  });

  it('laterAt keeps the newest and never lets junk win', () => {
    expect(laterAt('2026-07-30T10:00:00Z', '2026-07-30T11:00:00Z')).toBe('2026-07-30T11:00:00Z');
    expect(laterAt('2026-07-30T12:00:00Z', '2026-07-30T11:00:00Z')).toBe('2026-07-30T12:00:00Z');
    expect(laterAt('', '2026-07-30T11:00:00Z')).toBe('2026-07-30T11:00:00Z');
    expect(laterAt('2026-07-30T10:00:00Z', 'tomorrow-ish')).toBe('2026-07-30T10:00:00Z');
  });
});

// ── 2. Append idempotency ───────────────────────────────────────────────────
describe('ChatStore.appendOperator', () => {
  it('appends once across repeated polls of the same message', () => {
    const store = new ChatStore(config);
    const batch = [owner()];

    expect(store.appendOperator(batch)).toBe(1);
    expect(store.appendOperator(batch)).toBe(0);
    expect(store.appendOperator([owner()])).toBe(0); // a fresh object, same content

    expect(store.messages.filter((m) => m.role === 'owner')).toHaveLength(1);
  });

  it('survives a page reload — a replayed poll appends nothing after restore', () => {
    const first = new ChatStore(config);
    first.appendOperator([owner(), owner({ content: 'Anything else?', at: '2026-07-30T10:05:00Z' })]);

    // Reload: a new store rehydrates from localStorage, then the backend
    // replays the same list (e.g. it ignored `after`).
    const reloaded = new ChatStore(config);
    expect(reloaded.messages.filter((m) => m.role === 'owner')).toHaveLength(2);

    expect(
      reloaded.appendOperator([owner(), owner({ content: 'Anything else?', at: '2026-07-30T10:05:00Z' })]),
    ).toBe(0);
    expect(reloaded.messages.filter((m) => m.role === 'owner')).toHaveLength(2);
    expect(reloaded.messages.filter((m) => m.id === JOIN_NOTICE_ID)).toHaveLength(1);
  });

  it('drops ONE "a person joined" chip, before the first owner turn only', () => {
    const store = new ChatStore(config);
    store.appendOperator([owner()]);

    expect(store.messages[0]).toMatchObject({ role: 'system', content: JOIN_NOTICE, id: JOIN_NOTICE_ID });
    expect(store.messages[1]).toMatchObject({ role: 'owner', status: 'done' });

    store.appendOperator([owner({ content: 'second reply', at: '2026-07-30T10:09:00Z' })]);
    expect(store.messages.filter((m) => m.content === JOIN_NOTICE)).toHaveLength(1);
  });

  it('a system-only batch raises no join chip', () => {
    const store = new ChatStore(config);
    store.appendOperator([owner({ role: 'system', content: 'Conversation reopened' })]);

    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].role).toBe('system');
  });

  it('latestOperatorAt tracks the newest cursor, ignoring bot/visitor turns', () => {
    const store = new ChatStore(config);
    expect(store.latestOperatorAt()).toBe('');

    store.appendOperator([
      owner({ at: '2026-07-30T10:00:00Z' }),
      owner({ content: 'later', at: '2026-07-30T12:00:00Z' }),
      owner({ content: 'earlier', at: '2026-07-30T09:00:00Z' }),
    ]);

    expect(store.latestOperatorAt()).toBe('2026-07-30T12:00:00Z');
  });
});

// ── 3. Persistence of the new roles ─────────────────────────────────────────
describe('transcript persistence for owner + system turns', () => {
  it('round-trips both roles with their timestamps', () => {
    saveTranscript('w1', [
      { id: 'u1', role: 'user', content: 'anyone there?', status: 'done' },
      { id: 's1', role: 'system', content: JOIN_NOTICE, status: 'done', at: '2026-07-30T10:00:00Z' },
      { id: 'o1', role: 'owner', content: 'Ada here!', status: 'done', at: '2026-07-30T10:00:01Z' },
    ]);

    const restored = loadTranscript('w1');

    expect(restored.map((m) => m.role)).toEqual(['user', 'system', 'owner']);
    expect(restored[2]).toMatchObject({ id: 'o1', content: 'Ada here!', at: '2026-07-30T10:00:01Z' });
    expect(restored.every((m) => m.status !== 'streaming')).toBe(true);
  });

  it('never rehydrates a streaming owner turn and drops an unknown role', () => {
    window.localStorage.setItem(
      'pawbar.transcript.v1.w1',
      JSON.stringify({
        saved_at: Date.now(),
        messages: [
          { id: 'o1', role: 'owner', content: 'mid-flight', status: 'streaming', at: '2026-07-30T10:00:00Z' },
          { id: 'x1', role: 'moderator', content: 'invented speaker', status: 'done' },
        ],
      }),
    );

    const restored = loadTranscript('w1');

    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ role: 'owner', status: 'done' });
  });

  it('exports owner + system turns in the plain-text download', () => {
    const text = serializeTranscript(
      [
        { id: 'u1', role: 'user', content: 'anyone there?', status: 'done' },
        { id: 's1', role: 'system', content: JOIN_NOTICE, status: 'done' },
        { id: 'o1', role: 'owner', content: 'Ada here!', status: 'done' },
      ],
      'Concierge',
      new Date('2026-07-30T00:00:00Z'),
    );

    expect(text).toContain('Visitor: anyone there?');
    expect(text).toContain(`— ${JOIN_NOTICE}`);
    expect(text).toContain('Team: Ada here!');
  });
});

// ── 4. The paused-bot turn (human_replying frame) ───────────────────────────
describe('human_replying frame', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(enc(p));
        c.close();
      },
    });
  }

  it('finalizes without the "No reply." error and shows the line as a system chip', async () => {
    const body =
      'event: human_replying\ndata: {"message":"Someone from the team is replying…"}\n\n' +
      'event: stream_end\ndata: {}\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: streamOf(body) }));

    const store = new ChatStore(config);
    await store.send('is anyone there?');

    expect(store.error).toBeNull();
    expect(store.isStreaming).toBe(false);
    expect(store.botPaused).toBe(true);
    expect(store.messages.map((m) => m.role)).toEqual(['user', 'system']);
    expect(store.messages[1].content).toBe('Someone from the team is replying…');
    expect(store.messages.some((m) => m.status === 'error')).toBe(false);
  });

  it('falls back to house copy when the frame carries no message', async () => {
    const body = 'event: human_replying\ndata: {}\n\nevent: stream_end\ndata: {}\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: streamOf(body) }));

    const store = new ChatStore(config);
    await store.send('hello?');

    expect(store.error).toBeNull();
    expect(store.messages[1].role).toBe('system');
    expect(store.messages[1].content.length).toBeGreaterThan(0);
  });

  it('does not stack a chip per message while the bot stays paused', async () => {
    const body =
      'event: human_replying\ndata: {"message":"Someone from the team is replying…"}\n\n' +
      'event: stream_end\ndata: {}\n\n';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve({ ok: true, body: streamOf(body) })),
    );

    const store = new ChatStore(config);
    await store.send('first');
    await store.send('second');

    expect(store.messages.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(store.error).toBeNull();
  });

  it('still flags a genuinely empty reply from a normal (unpaused) turn', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, body: streamOf('event: stream_end\ndata: {}\n\n') }),
    );

    const store = new ChatStore(config);
    await store.send('hi');

    expect(store.error).toBe('No reply.');
  });

  it('finalizes even when the backend hangs up without a stream_end', async () => {
    const body = 'event: human_replying\ndata: {"message":"A person is replying"}\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: streamOf(body) }));

    const store = new ChatStore(config);
    await store.send('hello?');

    expect(store.isStreaming).toBe(false);
    expect(store.error).toBeNull();
  });
});

// ── 5. Poll lifecycle ───────────────────────────────────────────────────────
describe('OperatorStore lifecycle', () => {
  function pollMock(payload: unknown = { messages: [], bot_paused: false }) {
    const mock = vi.fn().mockResolvedValue(jsonRes(payload));
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  it('polls immediately on start, then on the interval, and stops on close', async () => {
    vi.useFakeTimers();
    const fetchMock = pollMock();
    const operator = new OperatorStore(new ChatStore(config), config);

    operator.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the visitor sees pending replies at once
    expect(operator.running).toBe(true);

    await vi.advanceTimersByTimeAsync(OPERATOR_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    operator.stop();
    expect(operator.running).toBe(false);
    await vi.advanceTimersByTimeAsync(OPERATOR_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(2); // silent after the panel closes
  });

  it('a second start never schedules a second interval', async () => {
    vi.useFakeTimers();
    const fetchMock = pollMock();
    const operator = new OperatorStore(new ChatStore(config), config);

    operator.start();
    operator.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(OPERATOR_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2); // not 4
    operator.stop();
  });

  it('pauses while the tab is hidden and catches up on return', async () => {
    const fetchMock = pollMock();
    const operator = new OperatorStore(new ChatStore(config), config);

    setHidden(true);
    operator.start();
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    operator.stop();
  });

  it('never stacks requests behind a slow backend', async () => {
    // Resolvers in an array, not a `let` — the in-flight latch is the thing
    // under test, so the mock must stay open until we say so.
    const pending: Array<() => void> = [];
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(() => resolve(jsonRes({ messages: [], bot_paused: false })));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const operator = new OperatorStore(new ChatStore(config), config);

    void operator.poll();
    await tick();
    void operator.poll();
    void operator.poll();
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending[0]();
    await tick();
    void operator.poll();
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('appends polled owner turns and advances the cursor', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes({
          messages: [{ role: 'owner', content: 'Ada here', at: '2026-07-30T10:00:00Z' }],
          bot_paused: true,
        }),
      )
      .mockResolvedValue(jsonRes({ messages: [], bot_paused: true }));
    vi.stubGlobal('fetch', fetchMock);

    const chat = new ChatStore(config);
    const operator = new OperatorStore(chat, config);

    await operator.poll();
    expect(chat.botPaused).toBe(true);
    expect(chat.messages.filter((m) => m.role === 'owner')).toHaveLength(1);
    expect(operator.after).toBe('2026-07-30T10:00:00Z');

    await operator.poll();
    expect(String(fetchMock.mock.calls[1][0])).toContain('after=2026-07-30T10%3A00%3A00Z');
  });

  it('seeds its cursor from a restored transcript so a reload does not replay', async () => {
    saveTranscript('w1', [
      { id: 'o1', role: 'owner', content: 'Ada here', status: 'done', at: '2026-07-30T10:00:00Z' },
    ]);
    const fetchMock = pollMock();

    const operator = new OperatorStore(new ChatStore(config), config);
    expect(operator.after).toBe('2026-07-30T10:00:00Z');

    await operator.poll();
    expect(String(fetchMock.mock.calls[0][0])).toContain('after=2026-07-30T10%3A00%3A00Z');
  });

  it('a 404 backend changes nothing — no messages, no paused state, no throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ detail: 'unknown widget' }, 404));
    vi.stubGlobal('fetch', fetchMock);

    const chat = new ChatStore(config);
    chat.messages.push({ id: 'u1', role: 'user', content: 'hi', status: 'done' });
    const operator = new OperatorStore(chat, config);

    await operator.poll();

    expect(chat.messages).toHaveLength(1);
    expect(chat.botPaused).toBe(false);
    expect(operator.after).toBe('');
  });
});
