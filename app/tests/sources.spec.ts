// tests/sources.spec.ts — Per-reply source citations. Created 2026-07-30
// (sources on replies). Pins the whole path: the optional `sources` SSE frame
// routed through dispatchFrame (sanitized, capped, http(s)-only — never a
// javascript: href on the public origin), the ChatStore attaching the list to
// the streaming assistant turn, transcript persist/restore round-tripping the
// citations, absence leaving old-backend streams untouched, and the plain-text
// serializer staying byte-identical with sources present.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { dispatchFrame, type ChatCallbacks } from '../src/lib/chat-client';
import { sanitizeSources, SOURCES_CAP, type Source } from '../src/lib/sources';
import { loadTranscript, saveTranscript, serializeTranscript } from '../src/lib/transcript';
import { ChatStore, type Message } from '../src/store/chat.svelte';

const CHUNK = 'event: chunk\ndata: {"content":"We open at 8am!","type":"text"}\n\n';
const SOURCES =
  'event: sources\ndata: {"sources":[{"title":"Opening hours","url":"https://cafe.example/hours"},{"title":"Visit us","url":"https://cafe.example/visit"}]}\n\n';
const END = 'event: stream_end\ndata: {"assistant_message_id":"m1","cancelled":false}\n\n';
const enc = (s: string) => new TextEncoder().encode(s);
const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };

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

function callbacks(): ChatCallbacks & { sources: Source[][] } {
  const sources: Source[][] = [];
  return {
    sources,
    onChunk: () => {},
    onEnd: () => {},
    onError: () => {},
    onSources: (s) => sources.push(s),
  };
}

const msg = (over: Partial<Message> = {}): Message => ({
  id: over.id ?? `m-${Math.random().toString(16).slice(2)}`,
  role: over.role ?? 'user',
  content: over.content ?? 'hello',
  status: over.status ?? 'done',
  ...(over.sources ? { sources: over.sources } : {}),
});

describe('sanitizeSources', () => {
  it('keeps valid http(s) rows and drops everything unsafe or malformed', () => {
    const out = sanitizeSources([
      { title: 'Hours', url: 'https://cafe.example/hours' },
      { title: 'Menu', url: 'http://cafe.example/menu' },
      { title: 'Evil', url: 'javascript:alert(1)' },
      { title: 'Data', url: 'data:text/html,x' },
      { title: '', url: 'https://cafe.example/blank-title' },
      { title: 42, url: 'https://cafe.example/bad-title' },
      'not-an-object',
      null,
    ]);
    expect(out).toEqual([
      { title: 'Hours', url: 'https://cafe.example/hours' },
      { title: 'Menu', url: 'http://cafe.example/menu' },
    ]);
  });

  it('caps at SOURCES_CAP and tolerates non-array payloads', () => {
    const many = Array.from({ length: SOURCES_CAP + 3 }, (_, i) => ({
      title: `Page ${i}`,
      url: `https://cafe.example/${i}`,
    }));
    expect(sanitizeSources(many)).toHaveLength(SOURCES_CAP);
    expect(sanitizeSources(undefined)).toEqual([]);
    expect(sanitizeSources('nope')).toEqual([]);
    expect(sanitizeSources({ title: 't', url: 'https://x.example' })).toEqual([]);
  });
});

describe('dispatchFrame sources event', () => {
  it('routes a sources frame to onSources and keeps reading', () => {
    const cb = callbacks();
    const keep = dispatchFrame(
      { event: 'sources', data: '{"sources":[{"title":"Hours","url":"https://cafe.example/hours"}]}' },
      cb,
    );
    expect(keep).toBe(true);
    expect(cb.sources).toEqual([[{ title: 'Hours', url: 'https://cafe.example/hours' }]]);
  });

  it('ignores a malformed or empty sources frame', () => {
    const cb = callbacks();
    expect(dispatchFrame({ event: 'sources', data: '{not json' }, cb)).toBe(true);
    expect(dispatchFrame({ event: 'sources', data: '{"sources":[]}' }, cb)).toBe(true);
    expect(dispatchFrame({ event: 'sources', data: '{"sources":"x"}' }, cb)).toBe(true);
    expect(cb.sources).toEqual([]);
  });

  it('does not crash when the caller passed no onSources (old callers)', () => {
    const cb: ChatCallbacks = { onChunk: () => {}, onEnd: () => {}, onError: () => {} };
    expect(() =>
      dispatchFrame({ event: 'sources', data: '{"sources":[{"title":"t","url":"https://x.example"}]}' }, cb),
    ).not.toThrow();
  });
});

describe('ChatStore sources attachment', () => {
  it('attaches sources to the assistant turn and persists them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: streamOf(CHUNK + SOURCES + END) }));

    const store = new ChatStore(config);
    await store.send('When do you open?');

    expect(store.messages[1].sources).toEqual([
      { title: 'Opening hours', url: 'https://cafe.example/hours' },
      { title: 'Visit us', url: 'https://cafe.example/visit' },
    ]);

    // Restored on the next load (= a fresh store on the same widget).
    const rehydrated = new ChatStore(config);
    expect(rehydrated.messages[1].sources).toEqual(store.messages[1].sources);
  });

  it('leaves the turn without sources when the backend never emits the frame', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: streamOf(CHUNK + END) }));

    const store = new ChatStore(config);
    await store.send('hi');

    expect(store.messages[1].status).toBe('done');
    expect(store.messages[1].content).toBe('We open at 8am!');
    expect(store.messages[1].sources).toBeUndefined();
  });
});

describe('transcript round-trip with sources', () => {
  it('persists and restores an assistant turn\'s sources', () => {
    saveTranscript('w1', [
      msg({ content: 'q' }),
      msg({
        role: 'assistant',
        content: 'a',
        sources: [{ title: 'Hours', url: 'https://cafe.example/hours' }],
      }),
    ]);
    const restored = loadTranscript('w1');
    expect(restored[0].sources).toBeUndefined();
    expect(restored[1].sources).toEqual([{ title: 'Hours', url: 'https://cafe.example/hours' }]);
  });

  it('re-sanitizes a tampered stored row on load', () => {
    window.localStorage.setItem(
      'pawbar.transcript.v2.w1.active',
      JSON.stringify({
        saved_at: Date.now(),
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            content: 'a',
            status: 'done',
            sources: [
              { title: 'Evil', url: 'javascript:alert(1)' },
              { title: 'Fine', url: 'https://cafe.example/ok' },
            ],
          },
        ],
      }),
    );
    const restored = loadTranscript('w1');
    expect(restored[0].sources).toEqual([{ title: 'Fine', url: 'https://cafe.example/ok' }]);
  });

  it('serializeTranscript output is unchanged by sources', () => {
    const thread = [
      msg({ content: 'Do you deliver?' }),
      msg({ role: 'assistant', content: 'Yes.', sources: [{ title: 'FAQ', url: 'https://x.example/faq' }] }),
    ];
    const bare = [msg({ id: thread[0].id, content: 'Do you deliver?' }), msg({ id: thread[1].id, role: 'assistant', content: 'Yes.' })];
    const when = new Date('2026-07-30T12:00:00Z');
    expect(serializeTranscript(thread, 'Concierge', when)).toBe(serializeTranscript(bare, 'Concierge', when));
  });
});
